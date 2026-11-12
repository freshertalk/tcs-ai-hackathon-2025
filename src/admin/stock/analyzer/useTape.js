// Fetches the intraday tape for the chart at 1-minute or 5-minute resolution, and
// keeps it fresh while the market is open: a new bar arrives every minute, and the
// bar still forming follows the live price in between.

import { useEffect, useState } from "react";
import { api } from "../../api";

/**
 * @param interval  1 or 5 (minutes per bar)
 * @param enabled   fetch at all (the tape needs the Zerodha connection)
 * @param polling   refresh every ten seconds (market hours)
 * @returns { loading, data: { available, step, tape, fast } | null, error }
 */
export default function useTape(symbol, interval, enabled, polling) {
  const [state, setState] = useState({ loading: Boolean(enabled), data: null, error: "" });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, data: null, error: "" });
      return undefined;
    }
    let alive = true;
    let busy = false;
    const pull = (quiet) => {
      if (busy) return; // a slow answer must not pile up behind the next poll
      busy = true;
      if (!quiet) setState({ loading: true, data: null, error: "" });
      api(`/api/admin/market/tape/${encodeURIComponent(symbol)}?interval=${interval}`)
        .then((d) => alive && setState({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setState((s) => ({ loading: false, data: s.data, error: e.message })))
        .finally(() => {
          busy = false;
        });
    };
    pull(false);
    const id = polling ? setInterval(() => pull(true), 10000) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [symbol, interval, enabled, polling]);

  return state;
}
