// One place that fetches the desk verdict for the open stock and keeps it fresh:
// every 2 seconds while the market is open (the price itself streams tick by tick). It also remembers each time the live
// call changes (wait → long in play, and so on) and can sound an alert when it does.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, peek } from "../../api";

const ALERT_KEY = "vpt.desk.alerts";
const WORD = { long: "LONG in play", short: "SHORT in play", "wait-long": "WAIT · long side", "wait-short": "WAIT · short side", wait: "WAIT · no edge", "no-trade": "NO TRADE" };

/** A short label for a live call: "LONG in play", "WAIT · short side", "Off". */
export const callLabel = (day) => (day && day.available ? WORD[day.state] || day.state : "Off");
export const callTone = (day) => (!day || !day.available ? "off" : day.side === "long" ? "long" : day.side === "short" ? "short" : day.state === "no-trade" ? "off" : "flat");
export const callActive = (day) => Boolean(day && day.available && (day.state === "long" || day.state === "short"));

const stored = () => {
  try {
    return window.localStorage.getItem(ALERT_KEY) === "1";
  } catch (_) {
    return false;
  }
};

export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22].forEach((at) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch (_) {
    /* no audio available — the on-screen change log still records it */
  }
}

export function notify(title, body) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, tag: "vpt-desk" });
  } catch (_) {
    /* notifications blocked — fine */
  }
}

export default function useVerdict(symbol, status) {
  const [state, setState] = useState({ loading: true });
  const [log, setLog] = useState([]);
  const [alerts, setAlerts] = useState(stored);
  const prev = useRef(null);
  const inFlight = useRef(false);
  const alertsOn = useRef(alerts);
  alertsOn.current = alerts;
  const live = status.mode === "kite";

  const load = useCallback(
    (quiet) => {
      // a slow answer must not pile up behind the next poll
      if (quiet && inFlight.current) return () => {};
      inFlight.current = true;
      let alive = true;
      // coming back to a stock within a minute: its last verdict shows while the new one loads
      const seenBefore = quiet ? null : peek(`/api/admin/market/verdict/${encodeURIComponent(symbol)}`, 60000);
      if (!quiet) setState(seenBefore ? { loading: false, data: seenBefore } : { loading: true });
      api(`/api/admin/market/verdict/${encodeURIComponent(symbol)}`)
        .then((d) => {
          if (!alive) return;
          setState({ loading: false, data: d });
          const day = d.available && d.day && d.day.available ? d.day : null;
          if (!day) return;
          const was = prev.current;
          prev.current = { state: day.state, label: callLabel(day) };
          if (was && was.state !== day.state) {
            setLog((l) => [{ at: d.at, from: was.label, to: callLabel(day), state: day.state, side: day.side, headline: day.headline, price: day.movement.last }, ...l].slice(0, 25));
            if (alertsOn.current) {
              beep();
              notify(`${symbol}: ${callLabel(day)}`, `${day.headline} — at ₹${day.movement.last}`);
            }
          }
        })
        .catch((e) => alive && setState((s) => (quiet && s.data ? { ...s, refreshError: e.message } : { loading: false, error: e.message })))
        .finally(() => {
          inFlight.current = false;
        });
      return () => {
        alive = false;
      };
    },
    [symbol]
  );

  useEffect(() => load(false), [load]);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => load(true), status.marketHours ? 2000 : 5 * 60000);
    return () => clearInterval(id);
  }, [live, status.marketHours, load]);

  const toggleAlerts = useCallback(() => {
    setAlerts((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(ALERT_KEY, next ? "1" : "0");
      } catch (_) {
        /* private mode — the choice lasts for this visit */
      }
      if (next) {
        beep(); // so you know what it sounds like, and the browser allows sound later
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
        } catch (_) {
          /* not supported */
        }
      }
      return next;
    });
  }, []);

  return { state, reload: () => load(Boolean(state.data)), log, alerts, toggleAlerts };
}
