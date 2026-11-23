import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { everyVisible } from "../visible";

// the Calendar page draws two cards (BSE / NSE and NASDAQ) that read the same answer: one request serves both when they
// ask within a moment of each other
let shared = null;
const readShared = () => {
  if (shared) return shared;
  shared = api("/api/admin/stock/holidays").finally(() => {
    setTimeout(() => {
      shared = null;
    }, 1000);
  });
  return shared;
};

/**
 * The official holiday copies the server keeps in step with the exchanges
 * (GET /api/admin/stock/holidays), plus a "check now" that asks the server to
 * look at the exchange again. Nothing is fetched when `enabled` is false.
 *
 * status: "loading" | "ready" | "unreachable"   (unreachable = our own server, not the exchange)
 */
export function useOfficialHolidays(enabled = true) {
  const [state, setState] = useState({ status: enabled ? "loading" : "idle", data: null, error: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await readShared();
      setState({ status: "ready", data, error: "" });
    } catch (err) {
      setState((s) => ({ status: "unreachable", data: s.data, error: err.message }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    // NSE's list changing at the source (the server's six-hourly check) reaches an open page at once (23 Nov 2026)
    const stop = everyVisible(load, 15 * 60000, { topics: ["holidays"] });
    return stop;
  }, [enabled, load]);

  // which: "nasdaq" (Nasdaq Trader, the default) or "nse" (NSE's own list). The answer is merged into what is held, so
  // checking one source never drops the other's copy.
  const checkNow = useCallback(async (which = "nasdaq") => {
    setBusy(true);
    try {
      const url = which === "nse" ? "/api/admin/stock/holidays/nse/refresh" : "/api/admin/stock/holidays/refresh";
      const data = await api(url, { method: "POST" });
      setState((s) => ({ status: "ready", data: { ...(s.data || {}), ...(data || {}) }, error: "" }));
    } catch (err) {
      setState((s) => ({ status: "unreachable", data: s.data, error: err.message }));
    }
    setBusy(false);
  }, []);

  return { ...state, busy, checkNow };
}
