// What the autopilot has to say, read from the server: its board (proposals, events, the record) and one stock's playbook.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";

const enc = encodeURIComponent;

/** The board: re-read every 30 seconds while a page is showing it. `reload` reads it now. */
export function useAutopilotBoard(every = 30000) {
  const [s, setS] = useState({ loading: true, data: null, error: "" });
  const read = useCallback(
    () =>
      api("/api/admin/autopilot")
        .then((d) => setS({ loading: false, data: d, error: "" }))
        .catch((e) => setS((p) => ({ loading: false, data: p.data, error: e.message }))),
    []
  );
  useEffect(() => {
    let alive = true;
    const go = () => alive && typeof document !== "undefined" && document.visibilityState !== "hidden" && read();
    read();
    const id = setInterval(go, every);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [read, every]);
  return { ...s, reload: read, set: (data) => setS({ loading: false, data, error: "" }) };
}

/** One stock's playbook: re-read every 20 seconds while the market is open (the scenarios' states move), else every 5 minutes. */
export function usePlaybook(symbol, enabled = true) {
  const [s, setS] = useState({ loading: Boolean(enabled), data: null, error: "" });
  useEffect(() => {
    let alive = true;
    setS({ loading: Boolean(enabled), data: null, error: "" });
    if (!enabled || !symbol) return undefined;
    let open = false;
    const read = () =>
      api(`/api/admin/autopilot/playbook/${enc(symbol)}`)
        .then((d) => {
          open = Boolean(d && d.open);
          if (alive) setS({ loading: false, data: d, error: "" });
        })
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    let last = Date.now();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (Date.now() - last >= (open ? 20000 : 300000)) {
        last = Date.now();
        read();
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, enabled]);
  return s;
}
