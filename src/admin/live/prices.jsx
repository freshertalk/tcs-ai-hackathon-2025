// Live prices for any list a page shows (23 Nov 2026): the page keeps its own rows; this swaps in each stock's price and day change
// from the one shared tick stream (stock/analyzer/liveTicks.js) the moment Zerodha sends a tick — and a price that moves flashes
// green or red for an instant. Without the stream (Zerodha not connected, or a symbol it does not stream) the page's own numbers stand.

import React, { useEffect, useMemo, useRef } from "react";
import { useLiveTicks } from "../stock/analyzer/liveTicks";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** The newest tick of each symbol: { SYMBOL: { last, changePct, prevClose, … } }, refreshed once a second. */
export function useLivePrices(symbols, enabled = true) {
  const key = useMemo(() => [...new Set((symbols || []).filter(Boolean))].sort().join(","), [symbols]);
  const list = useMemo(() => (key ? key.split(",") : []), [key]);
  const live = useLiveTicks(list, Boolean(enabled && list.length));
  return { prices: live.slow || {}, state: live.state };
}

/** A row with its live price and change put in (when there is a tick for it). `field` names the symbol. */
export function liveRow(row, prices, field = "symbol") {
  const t = row && prices ? prices[row[field]] : null;
  if (!t || !isNum(t.last) || t.last <= 0) return row;
  const changePct = isNum(t.changePct) ? Math.round(t.changePct * 100) / 100 : isNum(t.prevClose) && t.prevClose > 0 ? Math.round(((t.last - t.prevClose) / t.prevClose) * 10000) / 100 : row.changePct;
  return { ...row, last: t.last, changePct, live: true };
}

/** A value that flashes when it changes: up green, down red (off with "reduce motion" and Customize → motion off). */
export function Flash({ value, children, className = "" }) {
  const prev = useRef(value);
  const dir = isNum(value) && isNum(prev.current) && value !== prev.current ? (value > prev.current ? "up" : "down") : "";
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span key={dir ? `${value}` : "same"} className={`lv-flash ${dir ? `is-${dir}` : ""} ${className}`.trim()}>
      {children}
    </span>
  );
}
