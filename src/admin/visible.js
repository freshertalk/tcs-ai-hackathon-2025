// Polling that respects hidden tabs. A tab in the background does not poll (live streams still
// arrive there); the moment it is shown again — the tab is switched to, the window gets focus, or
// the network comes back — it catches up at once if a beat was missed, so a status is never stale
// when you look at it. With the terminal open in several tabs, only the tabs being looked at put
// load on the server.

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Call `fn` every `ms` while the tab is visible. Returns the function that stops it (for useEffect).
 * @param catchUp  when the tab is shown again after missing a beat, call `fn` straight away
 */
export function everyVisible(fn, ms, { catchUp = true } = {}) {
  let last = Date.now();
  const run = () => {
    last = Date.now();
    fn();
  };
  const id = setInterval(() => {
    if (!hidden()) run();
  }, ms);
  // shown again (visibility), focused again, or back online after being offline: look now if a beat was missed
  const onShow = () => {
    if (!hidden() && catchUp && Date.now() - last >= Math.min(ms, 5000)) run();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onShow);
  }
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onShow);
    }
  };
}
