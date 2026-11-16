// Polling that respects hidden tabs. A tab in the background does not poll (live streams still
// arrive there); the moment it is shown again it catches up at once if a beat was missed. With the
// terminal open in several tabs, only the tabs being looked at put load on the server.

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
  const onShow = () => {
    if (!hidden() && catchUp && Date.now() - last >= ms) run();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  return () => {
    clearInterval(id);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
  };
}
