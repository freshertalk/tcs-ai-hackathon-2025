// What /me's first screen reads, and how often. Only what the server already works out — no AI is asked, nothing is sent
// to the broker but reads. A tab in the background does not poll (visible.js); a change the server announces is read at
// once. A part that fails keeps its last answer and says so; it never takes the others with it.

import { useEffect, useState } from "react";
import { api } from "../api";
import { everyVisible } from "../visible";
import { QUOTES_URL } from "./homeData";

/** Reads each of `urls` { key: path } every `ms`, and when a live topic says so. @returns { key: answer, errors: {} } */
function useReads(urls, ms, topics) {
  const [d, setD] = useState({ errors: {} });
  const list = JSON.stringify(urls);
  useEffect(() => {
    const entries = Object.entries(JSON.parse(list));
    if (!entries.length) return undefined;
    let alive = true;
    const load = () => {
      entries.forEach(([key, path]) => {
        api(path)
          .then((v) => alive && setD((x) => ({ ...x, [key]: v, errors: { ...x.errors, [key]: null } })))
          .catch((e) => alive && setD((x) => ({ ...x, errors: { ...x.errors, [key]: (e && e.message) || "Could not be read." } })));
      });
    };
    load();
    const stop = everyVisible(load, ms, { topics });
    return () => {
      alive = false;
      stop();
    };
    // the list of topics is a constant at each call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, ms]);
  return d;
}

/** Prices, the market's reading and the slower daily work. `on` false (hidden under Customize) reads nothing. */
export function useMarketData(on) {
  const status = useReads(on ? { status: "/api/admin/market/status" } : {}, 60000, ["market"]);
  const fast = useReads(on ? { quotes: QUOTES_URL } : {}, status.status && status.status.marketHours ? 10000 : 60000, ["market"]);
  const mid = useReads(on ? { context: "/api/admin/market/context", alerts: "/api/admin/market/alerts" } : {}, 60000, ["market", "alerts"]);
  const slow = useReads(
    on ? { scan: "/api/admin/market/scan", edge: "/api/admin/market/edge", setup: "/api/admin/market/setup", expiries: "/api/admin/market/expiries" } : {},
    180000,
    ["expiry"]
  );
  return {
    status: status.status,
    quotes: fast.quotes,
    context: mid.context,
    alerts: mid.alerts,
    scan: slow.scan,
    edge: slow.edge,
    setup: slow.setup,
    expiries: slow.expiries,
    errors: { ...status.errors, ...fast.errors, ...mid.errors, ...slow.errors },
  };
}

/** The signed-in person's own Zerodha account: its status first, and the figures only while it is connected. */
export function useAccountData(on) {
  const s = useReads(on ? { status: "/api/admin/trading/status" } : {}, 60000, ["trading"]);
  const connected = Boolean(s.status && s.status.connected);
  const f = useReads(on && connected ? { summary: "/api/admin/trading/summary" } : {}, 30000, ["trading"]);
  return { status: s.status, summary: connected ? f.summary : undefined, errors: { ...s.errors, ...f.errors } };
}
