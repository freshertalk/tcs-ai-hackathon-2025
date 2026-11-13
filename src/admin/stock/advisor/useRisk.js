// The money you are willing to lose on one trade, remembered in this browser and shared by
// every part of the page that sizes a trade from it.

import { useCallback, useEffect, useState } from "react";

const KEY = "vpt.advisor.risk";
const EVENT = "vpt:risk";
const DEFAULT = 1000;

function read() {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return v > 0 ? v : DEFAULT;
  } catch (_) {
    return DEFAULT;
  }
}

/** @returns [risk in rupees, set] */
export function useRisk() {
  const [risk, setRiskState] = useState(read);
  useEffect(() => {
    const on = () => setRiskState(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const setRisk = useCallback((v) => {
    const n = Math.max(0, Math.min(10000000, Math.round(Number(v) || 0)));
    setRiskState(n);
    if (!(n > 0)) return; // an empty box while typing is not saved
    try {
      window.localStorage.setItem(KEY, String(n));
    } catch (_) {
      /* remembered for this visit only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [risk, setRisk];
}
