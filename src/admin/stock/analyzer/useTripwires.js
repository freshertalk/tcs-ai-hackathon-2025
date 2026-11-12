// Runs the tripwires on the live stream for the open stock: every tick is checked
// against the levels of the latest call, the instant it arrives.

import { useContext, useEffect, useRef, useState } from "react";
import { TickContext } from "./liveTicks";
import { checkWires, wiresFrom } from "./tripwires";
import { beep, notify } from "./useVerdict";

/**
 * @param verdict  the latest desk verdict (its levels are the wires)
 * @param opts     { alerts: sound on a stop / target / trigger, refresh: read the call again now }
 * @returns events, newest first
 */
export default function useTripwires(symbol, verdict, { alerts, refresh }) {
  const store = useContext(TickContext);
  const [events, setEvents] = useState([]);
  // the wires follow the newest verdict without restarting the subscription
  const cfg = useRef({ wires: [], atr: null });
  cfg.current = wiresFrom(verdict);
  const opts = useRef({ alerts, refresh });
  opts.current = { alerts, refresh };

  useEffect(() => {
    if (!store) return undefined;
    let prev = null;
    const memo = {};
    return store.subscribe(symbol, () => {
      const t = store.get(symbol);
      if (!t || typeof t.last !== "number") {
        prev = null; // the stream dropped: do not compare across the gap
        return;
      }
      // the first tick only sets the marks (price, the day's high and low) to compare against
      if (prev === null) {
        if (typeof t.high === "number") memo.high = t.high;
        if (typeof t.low === "number" && t.low > 0) memo.low = t.low;
      }
      const found = prev === null ? [] : checkWires(cfg.current, prev, t, memo, Date.now());
      prev = t.last;
      if (found.length === 0) return;
      setEvents((e) => [...found.slice().reverse(), ...e].slice(0, 40));
      const loud = found.find((x) => x.urgent);
      if (loud && opts.current.alerts) {
        beep();
        notify(`${symbol}`, loud.text);
      }
      if (found.some((x) => x.refresh)) opts.current.refresh();
    });
  }, [store, symbol]);

  return events;
}
