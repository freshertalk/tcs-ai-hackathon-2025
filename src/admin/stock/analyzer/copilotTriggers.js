// When should the live co-pilot be asked for a new reading? Pure decisions, kept
// apart from the hook so they can be tested: the page proposes, the server disposes
// (it enforces the minimum gap and the daily limit whatever the page asks).

export const STALE_TRIGGER_MS = 120000; // a trigger that has waited this long describes a moment that has passed

/**
 * Put a new trigger in the single waiting slot.
 * A real event replaces whatever is waiting; a timed refresh never replaces an event.
 * @param waiting  { reason, event, at } | null
 * @returns the slot's new content
 */
export function enqueue(waiting, reason, event, now) {
  if (reason === "refresh" && waiting) return waiting;
  return { reason, event: event || "", at: now };
}

/**
 * How old the newest reading is, in milliseconds — measured on the server's clock at the
 * moment the view was fetched, then advanced by the page's own clock. A page whose clock
 * is wrong by minutes still gets the right answer.
 * @param view       the server's view: { now, reads: [{ at }] }
 * @param fetchedAt  the page's clock when that view arrived
 */
export function readAgeMs(view, fetchedAt, now) {
  const last = view && view.reads && view.reads[0];
  if (!last) return null;
  const atFetch = Date.parse(view.now) - Date.parse(last.at);
  return Math.max(0, atFetch) + Math.max(0, now - fetchedAt);
}

/**
 * One turn of the pump: what, if anything, to ask for right now.
 * @param s { waiting, nextAt, busy, hidden, live, stopped, configured, refreshMin, ageMs }
 * @returns { waiting, ask }  ask is { reason, event } or null
 */
export function pump(s, now) {
  let waiting = s.waiting;
  if (!s.live || s.stopped || !s.configured) return { waiting: null, ask: null };
  if (waiting && now - waiting.at > STALE_TRIGGER_MS) waiting = null;
  // nothing has happened for a while: look again, if the settings ask for that
  if (!waiting && s.refreshMin > 0 && (s.ageMs === null || s.ageMs >= s.refreshMin * 60000)) waiting = enqueue(null, "refresh", "", now);
  // a page in a background tab does not spend anything; a request already running is not doubled
  if (!waiting || s.busy || s.hidden || now < s.nextAt) return { waiting, ask: null };
  return { waiting: null, ask: { reason: waiting.reason, event: waiting.event } };
}

export const REASON_LABEL = {
  manual: "you asked",
  "switched-on": "switched on",
  "call-change": "the call changed",
  tripwire: "a level broke",
  weakening: "an early warning",
  "flow-flip": "the order book tilted",
  refresh: "timed look",
};
