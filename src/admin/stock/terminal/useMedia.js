// Which kind of screen the terminal is on. The layout itself is CSS; these are for the few
// places where a different screen wants different parts on the page, not just different sizes.

import { useEffect, useState } from "react";

/** A phone held upright: one column, cards instead of wide tables. */
export const PHONE = "(max-width: 760px)";
/** Phones and tablets: the workspaces move from the top bar to a bar along the bottom edge. */
export const BOTTOM_NAV = "(max-width: 1100px)";
/** Room for a list and its detail side by side. */
export const SPLIT = "(min-width: 1600px)";

export function useMedia(query, fallback = false) {
  const can = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [on, setOn] = useState(() => (can ? window.matchMedia(query).matches : fallback));
  useEffect(() => {
    if (!can) return undefined;
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else mq.addListener(fn);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn));
  }, [query, can]);
  return on;
}
