// The live AI co-pilot for the open stock.
//
// "Live" here means event-driven, not a loop: while the switch is on and the page is
// in front of you, a new reading is asked for when the engine's call changes, when the
// price breaks one of the call's levels, when an early warning appears against the
// trade, and — if the settings say so — when a set time has passed with none of those.
// The server has the last word: it enforces the minimum gap and the daily limit.
// Switch it off, change stock, or put the tab in the background, and nothing is asked.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { enqueue, pump, readAgeMs } from "./copilotTriggers";

const KEY = "vpt.desk.copilot";
const enc = encodeURIComponent;

const storedOn = () => {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch (_) {
    return false;
  }
};

/**
 * @param day     the live intraday call (verdict.day) or null
 * @param log     call changes, newest first (from useVerdict)
 * @param events  level breaks, newest first (from useTripwires)
 * @param active  the session is live: Zerodha connected and the market open
 */
export default function useCopilot(symbol, { day, log, events, active }) {
  const [view, setView] = useState(null);
  const [on, setOn] = useState(storedOn);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({ kind: "", text: "" });
  const [, redraw] = useState(0); // the "38 s ago" label ticks by itself

  const live = Boolean(active && day && day.available);
  const configured = Boolean(view && view.configured);
  const r = useRef({ waiting: null, nextAt: 0, busy: false, stopped: false, fetchedAt: 0, greeted: false });
  const now = useRef({ live, on, view });
  now.current = { live, on, view };

  const take = useCallback((d) => {
    r.current.fetchedAt = Date.now();
    setView(d);
  }, []);

  // what it has said so far about this stock — reading it costs nothing
  useEffect(() => {
    let alive = true;
    r.current = { waiting: null, nextAt: 0, busy: false, stopped: false, fetchedAt: 0, greeted: false };
    setView(null);
    setNote({ kind: "", text: "" });
    api(`/api/admin/ai/live/${enc(symbol)}`)
      .then((d) => alive && take(d))
      .catch((e) => alive && setNote({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [symbol, take]);

  const ask = useCallback(
    (reason, event) => {
      if (r.current.busy) return;
      r.current.busy = true;
      setBusy(true);
      api(`/api/admin/ai/live/${enc(symbol)}`, { method: "POST", body: { reason, event } })
        .then((d) => {
          take(d);
          if (d.skipped) {
            // too soon: keep an event waiting until the server allows the next reading
            r.current.nextAt = Date.now() + (d.waitSec || 5) * 1000;
            if (reason !== "manual") r.current.waiting = enqueue(r.current.waiting, reason, event, Date.now());
            setNote(reason === "manual" ? { kind: "info", text: `Asked a moment ago. The next reading is allowed in ${d.waitSec} seconds.` } : { kind: "", text: "" });
          } else {
            r.current.nextAt = Date.now() + d.settings.minGapSec * 1000;
            setNote({ kind: "", text: "" });
          }
        })
        .catch((e) => {
          if (e.code === "cap_reached" || e.code === "not_configured") r.current.stopped = true;
          r.current.nextAt = Date.now() + 30000; // an error is not a reason to ask faster
          setNote({ kind: "error", text: e.message });
        })
        .finally(() => {
          r.current.busy = false;
          setBusy(false);
        });
    },
    [symbol, take]
  );

  const propose = useCallback((reason, event) => {
    const c = now.current;
    if (!c.on || !c.live || !c.view || !c.view.configured || r.current.stopped) return;
    r.current.waiting = enqueue(r.current.waiting, reason, event, Date.now());
  }, []);

  /* ---- the events worth a reading */
  const logKey = log && log[0] ? log[0].at : "";
  useEffect(() => {
    if (logKey) propose("call-change", `${log[0].from} → ${log[0].to}`);
  }, [logKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const eventKey = events && events[0] ? `${events[0].id}${events[0].at}` : "";
  useEffect(() => {
    if (eventKey && events[0].urgent) propose("tripwire", events[0].text);
  }, [eventKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const weakening = Boolean(day && day.available && day.weakening);
  useEffect(() => {
    if (!weakening) return;
    const first = (day.early || []).find((e) => e.against === day.side) || (day.early || [])[0];
    propose("weakening", first ? first.text : "");
  }, [weakening]); // eslint-disable-line react-hooks/exhaustive-deps

  // switched on (or the session came alive while it was on): one reading to start from
  useEffect(() => {
    if (!on) {
      r.current.greeted = false;
      r.current.waiting = null;
      return;
    }
    if (r.current.greeted || !live || !configured) return;
    r.current.greeted = true;
    propose("switched-on", "");
  }, [on, live, configured, propose]);

  // the pump: every few seconds, ask if something is waiting and it is allowed
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => {
      const c = now.current;
      const t = Date.now();
      const out = pump(
        {
          waiting: r.current.waiting,
          nextAt: r.current.nextAt,
          busy: r.current.busy,
          hidden: typeof document !== "undefined" && document.hidden,
          live: c.live,
          stopped: r.current.stopped,
          configured: Boolean(c.view && c.view.configured),
          refreshMin: c.view ? c.view.settings.refreshMin : 0,
          ageMs: readAgeMs(c.view, r.current.fetchedAt, t),
        },
        t
      );
      r.current.waiting = out.waiting;
      if (out.ask) ask(out.ask.reason, out.ask.event);
    }, 3000);
    return () => clearInterval(id);
  }, [on, ask]);

  // keep "… ago" honest between readings
  useEffect(() => {
    const id = setInterval(() => redraw((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        window.sessionStorage.setItem(KEY, next ? "1" : "0");
      } catch (_) {
        /* private mode — the choice lasts for this visit */
      }
      if (next) r.current.stopped = false;
      return next;
    });
  }, []);

  const askNow = useCallback(() => ask("manual", ""), [ask]);
  const ageMs = readAgeMs(view, r.current.fetchedAt, Date.now());

  return { view, on, toggle, askNow, busy, note, live, configured, ageMs };
}
