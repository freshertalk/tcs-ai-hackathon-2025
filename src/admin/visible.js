// Polling that respects hidden tabs, and refreshes the moment the server says something changed. A tab in the background does
// not poll (live streams still arrive there); the moment it is shown again — the tab is switched to, the window gets focus, or
// the network comes back — it catches up at once if a beat was missed, so a status is never stale when you look at it. With the
// terminal open in several tabs, only the tabs being looked at put load on the server.
//
// With `topics` the poll also listens to the live connection (live.js): when the server publishes a change to one of those
// topics the function runs at once (at most about once a second; a burst of changes becomes one refresh; a hidden tab refreshes
// when it is shown). The timer stays as the safety net, so a lost connection can only make a page slower, never stale for long.

import { onTopics } from "./live";

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const GAP = 800; // the least time between two refreshes caused by events

/**
 * Call `fn` every `ms` while the tab is visible. Returns the function that stops it (for useEffect).
 * @param catchUp  when the tab is shown again after missing a beat, call `fn` straight away
 * @param topics   live topics (see server/live.js) whose change should call `fn` at once
 */
export function everyVisible(fn, ms, { catchUp = true, topics = null } = {}) {
  let last = Date.now();
  let dirty = false;
  let trail = null;
  const run = () => {
    last = Date.now();
    dirty = false;
    fn();
  };
  const id = setInterval(() => {
    if (!hidden()) run();
  }, ms);
  // shown again (visibility), focused again, or back online after being offline: look now if a beat was missed
  const onShow = () => {
    if (hidden()) return;
    if (dirty) run();
    else if (catchUp && Date.now() - last >= Math.min(ms, 5000)) run();
  };
  // the server says something changed
  const poke = () => {
    if (hidden()) {
      dirty = true;
      return;
    }
    const wait = GAP - (Date.now() - last);
    if (wait <= 0) run();
    else if (!trail) {
      trail = setTimeout(() => {
        trail = null;
        if (hidden()) dirty = true;
        else run();
      }, wait);
    }
  };
  const unlive = topics && topics.length ? onTopics(topics, poke) : null;
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onShow);
  }
  return () => {
    clearInterval(id);
    clearTimeout(trail);
    if (unlive) unlive();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onShow);
    }
  };
}
