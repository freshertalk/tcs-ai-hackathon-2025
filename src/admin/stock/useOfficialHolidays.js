import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

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
      const data = await api("/api/admin/stock/holidays");
      setState({ status: "ready", data, error: "" });
    } catch (err) {
      setState((s) => ({ status: "unreachable", data: s.data, error: err.message }));
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const checkNow = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api("/api/admin/stock/holidays/refresh", { method: "POST" });
      setState({ status: "ready", data, error: "" });
    } catch (err) {
      setState((s) => ({ status: "unreachable", data: s.data, error: err.message }));
    }
    setBusy(false);
  }, []);

  return { ...state, busy, checkNow };
}
