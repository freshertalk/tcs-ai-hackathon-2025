// Exchange time on every page (23 Nov 2026). The owner's rule: no gap, not even a fraction of a second, between the time
// this site shows and NSE's (IST, UTC+05:30, as kept by India's national time servers).
//
// How: this computer's clock can be off by seconds. The server keeps its own clock checked against India's NIC time
// servers and public ones (server/clock.js). Here the page asks GET /api/admin/clock a few times, NTP-style: it notes
// when it asked (t0) and when the answer came (t3); the server says when the request arrived (t1) and when the answer
// left (t2), so offset = ((t1 − t0) + (t2 − t3)) / 2 with the server's handling time taken out. The sample with the
// shortest round trip wins (its error is at most half that round trip). exchangeNow() = this computer's clock + offset.
//
// Kept right by itself: again every 5 minutes, at once when the tab is shown again, the window is focused or the network
// comes back, and when this computer's clock JUMPS (a manual change, a sleep and wake): a 1-second watcher compares the
// wall clock with the steady one and re-syncs on a jump of a second or more. If the server cannot be reached the last
// offset stays (and with none yet, the computer's own clock is used — the status says so).
//
// Ticks: useExchangeNow() re-renders on the exact edge of each exchange second (not on a free-running timer that drifts
// up to a second late), so a clock shown on the page turns over with NSE's.

import { useEffect, useState } from "react";
import { api } from "../api";

const RESYNC_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 20 * 1000;
const SAMPLES = 4;
const GOOD_RTT_MS = 40; // a round trip this short is good enough: stop sampling

const state = { offset: 0, synced: false, rtt: null, accuracy: null, source: "this computer", serverSource: "", syncedAt: 0, error: "" };
const listeners = new Set();
let inflight = null;
let started = false;

const steady = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

/** NSE's time now, as milliseconds since 1970 (UTC). Format it in Asia/Kolkata to show IST. */
export function exchangeNow() {
  return Date.now() + state.offset;
}

/** What the page knows about its clock: { synced, offset, rtt, accuracy, source, syncedAt, error }. */
export function clockStatus() {
  return { ...state };
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (_) {
      /* one listener's trouble is not the clock's */
    }
  }
}

async function sampleOnce() {
  const t0 = Date.now();
  const d = await api("/api/admin/clock");
  const t3 = Date.now();
  if (!d || !Number.isFinite(d.t1) || !Number.isFinite(d.t2)) throw new Error("the server's clock did not answer");
  const offset = (d.t1 - t0 + (d.t2 - t3)) / 2;
  const rtt = t3 - t0 - (d.t2 - d.t1);
  return { offset, rtt: Math.max(0, rtt), d };
}

/** Measure the offset now (a few samples, the shortest round trip wins). Concurrent calls share one measurement. */
export function syncClock() {
  if (inflight) return inflight;
  inflight = (async () => {
    let best = null;
    for (let i = 0; i < SAMPLES; i += 1) {
      try {
        const s = await sampleOnce();
        if (!best || s.rtt < best.rtt) best = s;
        if (s.rtt <= GOOD_RTT_MS) break;
      } catch (err) {
        if (!best) state.error = String((err && err.message) || err);
        break;
      }
    }
    if (best) {
      state.offset = best.offset;
      state.rtt = Math.round(best.rtt);
      state.accuracy = Math.round(best.rtt / 2 + (Number(best.d.accuracyMs) || 0));
      state.serverSource = best.d.source || "";
      state.source = best.d.source === "ntp" ? "exchange time (India's time servers)" : "the server's clock";
      state.synced = true;
      state.syncedAt = Date.now();
      state.error = "";
    }
    notify();
    return clockStatus();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Start keeping the clock right (idempotent; every clock hook calls it). */
export function startExchangeClock() {
  if (started || typeof window === "undefined") return;
  started = true;
  syncClock().catch(() => {});
  setInterval(() => syncClock().catch(() => {}), RESYNC_MS);
  const again = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (Date.now() - state.syncedAt >= MIN_GAP_MS) syncClock().catch(() => {});
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", again);
  window.addEventListener("focus", again);
  window.addEventListener("online", again);
  // this computer's clock jumped (changed by hand, or a sleep and wake): measure again at once
  let wall = Date.now();
  let mono = steady();
  setInterval(() => {
    const w = Date.now();
    const m = steady();
    if (Math.abs(w - wall - (m - mono)) >= 1000) syncClock().catch(() => {});
    wall = w;
    mono = m;
  }, 1000);
}

/** For tests: forget the measurement. */
export function resetExchangeClock() {
  Object.assign(state, { offset: 0, synced: false, rtt: null, accuracy: null, source: "this computer", serverSource: "", syncedAt: 0, error: "" });
  inflight = null;
}

/**
 * NSE's time, re-rendered on the edge of every `every` ms of exchange time (1000 = each second, 60000 = each minute)
 * and whenever the clock is re-measured. Returns milliseconds since 1970 (UTC).
 */
export function useExchangeNow(every = 1000) {
  const [now, setNow] = useState(exchangeNow);
  useEffect(() => {
    startExchangeClock();
    let timer = null;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const t = exchangeNow();
      setNow(t);
      // the next edge of the exchange's second (or minute), plus 2 ms so the new value is past it
      timer = setTimeout(tick, every - (t % every) + 2);
    };
    tick();
    const onSync = () => {
      clearTimeout(timer);
      tick();
    };
    listeners.add(onSync);
    return () => {
      alive = false;
      clearTimeout(timer);
      listeners.delete(onSync);
    };
  }, [every]);
  return now;
}

/** The clock's state, re-rendered when it is re-measured. */
export function useClockStatus() {
  const [st, setSt] = useState(clockStatus);
  useEffect(() => {
    startExchangeClock();
    const on = () => setSt(clockStatus());
    listeners.add(on);
    return () => listeners.delete(on);
  }, []);
  return st;
}

const IST = 5.5 * 3600 * 1000;
/** { date: "2026-11-23", hh, mm, ss, minute: minutes after midnight, dow: 0 = Sunday } in IST for a moment. */
export function istParts(ms = exchangeNow()) {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
