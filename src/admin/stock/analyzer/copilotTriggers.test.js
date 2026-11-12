import { enqueue, pump, readAgeMs, STALE_TRIGGER_MS } from "./copilotTriggers";

const T = 1_000_000;
const base = { waiting: null, nextAt: 0, busy: false, hidden: false, live: true, stopped: false, configured: true, refreshMin: 10, ageMs: 60000 };

test("one waiting slot: an event replaces what is waiting, a timed refresh never replaces an event", () => {
  const a = enqueue(null, "call-change", "WAIT → LONG", T);
  expect(a).toEqual({ reason: "call-change", event: "WAIT → LONG", at: T });
  expect(enqueue(a, "refresh", "", T + 5)).toBe(a);
  expect(enqueue(a, "tripwire", "Stop hit", T + 9)).toEqual({ reason: "tripwire", event: "Stop hit", at: T + 9 });
  expect(enqueue(null, "refresh", undefined, T)).toEqual({ reason: "refresh", event: "", at: T });
});

test("the pump asks when something is waiting and nothing forbids it", () => {
  const waiting = enqueue(null, "weakening", "Dropping fast", T);
  expect(pump({ ...base, waiting }, T + 1000)).toEqual({ waiting: null, ask: { reason: "weakening", event: "Dropping fast" } });
  // too soon after the last reading, already asking, or the tab is in the background: it waits
  expect(pump({ ...base, waiting, nextAt: T + 60000 }, T + 1000)).toEqual({ waiting, ask: null });
  expect(pump({ ...base, waiting, busy: true }, T + 1000).ask).toBeNull();
  expect(pump({ ...base, waiting, hidden: true }, T + 1000).ask).toBeNull();
  // …and when the wait is over it goes
  expect(pump({ ...base, waiting, nextAt: T + 60000 }, T + 60000).ask).toEqual({ reason: "weakening", event: "Dropping fast" });
});

test("nothing is asked when the session is not live, the key is missing, or the daily limit was reached", () => {
  const waiting = enqueue(null, "tripwire", "x", T);
  for (const off of [{ live: false }, { configured: false }, { stopped: true }]) {
    expect(pump({ ...base, ...off, waiting }, T + 1000)).toEqual({ waiting: null, ask: null });
  }
});

test("a trigger that waited too long is dropped: it describes a moment that has passed", () => {
  const waiting = enqueue(null, "tripwire", "x", T);
  const out = pump({ ...base, waiting, nextAt: T + 10 * 60000 }, T + STALE_TRIGGER_MS + 1);
  expect(out).toEqual({ waiting: null, ask: null });
});

test("a timed look happens only when the settings ask for it and the last reading is old enough", () => {
  expect(pump({ ...base, ageMs: 9 * 60000 }, T).ask).toBeNull();
  expect(pump({ ...base, ageMs: 10 * 60000 }, T).ask).toEqual({ reason: "refresh", event: "" });
  expect(pump({ ...base, ageMs: null }, T).ask).toEqual({ reason: "refresh", event: "" });
  expect(pump({ ...base, refreshMin: 0, ageMs: 3600000 }, T)).toEqual({ waiting: null, ask: null });
  // a refresh that is due but not yet allowed stays in the slot
  expect(pump({ ...base, ageMs: 11 * 60000, nextAt: T + 5000 }, T)).toEqual({ waiting: { reason: "refresh", event: "", at: T }, ask: null });
});

test("the age of the last reading is measured on the server's clock, so a wrong clock on the page does not matter", () => {
  const view = { now: "2026-11-12T05:05:00.000Z", reads: [{ at: "2026-11-12T05:02:00.000Z" }] };
  // the page's clock is hours off; it only measures how long ago the view arrived
  expect(readAgeMs(view, 9_000_000, 9_000_000)).toBe(180000);
  expect(readAgeMs(view, 9_000_000, 9_030_000)).toBe(210000);
  expect(readAgeMs({ now: view.now, reads: [] }, 0, 0)).toBeNull();
  expect(readAgeMs(null, 0, 0)).toBeNull();
});
