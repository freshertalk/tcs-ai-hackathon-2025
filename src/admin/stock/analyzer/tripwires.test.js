import { checkWires, wiresFrom } from "./tripwires";

const verdict = (day, ladder = []) => ({ available: true, day: { available: true, movement: { vwap: 100 }, triggers: { long: 101, short: 99, rangeSet: true }, ...day }, movement: { atr: 4 }, ladder });
const waiting = verdict({ state: "wait", plan: null }, [{ label: "Previous day high", price: 103 }, { label: "Previous day low", price: 96 }, { label: "R1", price: 104 }]);
const long = verdict({ state: "long", plan: { side: "long", stop: 99.5, targets: [{ label: "1R", price: 103 }, { label: "2R", price: 105 }] } });
const short = verdict({ state: "short", plan: { side: "short", stop: 100.5, targets: [{ label: "1R", price: 97 }] } });
const ids = (evs) => evs.map((e) => e.id);
const tick = (last, extra = {}) => ({ last, ...extra });

test("which levels are wired depends on the call", () => {
  expect(wiresFrom(null)).toEqual({ wires: [], atr: null });
  expect(wiresFrom({ available: true, day: { available: false } }).wires).toEqual([]);
  expect(wiresFrom(waiting).wires.map((w) => w.id)).toEqual(["trigger-long", "trigger-short", "vwap", "Previous day high", "Previous day low"]);
  // in a long: its stop and targets, and only the opposite trigger
  expect(wiresFrom(long).wires.map((w) => w.id)).toEqual(["stop", "target-1R", "target-2R", "trigger-short", "vwap"]);
  expect(wiresFrom(long).atr).toBe(4);
  // no trade (wrong time of day, circuit…): triggers are not armed
  expect(wiresFrom(verdict({ state: "no-trade", plan: null })).wires.map((w) => w.id)).toEqual(["vwap"]);
});

test("a tick through a trigger rings at once and asks for the call to be read again", () => {
  const cfg = wiresFrom(waiting);
  const evs = checkWires(cfg, 100.9, tick(101.05), {}, 1000);
  expect(ids(evs)).toEqual(["trigger-long"]);
  expect(evs[0]).toMatchObject({ kind: "trigger", tone: "up", urgent: true, refresh: true, price: 101.05, at: 1000 });
  expect(evs[0].text).toMatch(/Through the long trigger ₹101\.00 — it counts once a 5-minute bar closes above it/);
  // falling back under it is said too, quietly
  const memo = {};
  checkWires(cfg, 100.9, tick(101.05), memo, 1000);
  const back = checkWires(cfg, 101.05, tick(100.9), memo, 2000);
  expect(back.find((e) => e.id === "trigger-long-back")).toMatchObject({ urgent: false, refresh: true });
  // the short side
  expect(checkWires(cfg, 99.2, tick(98.9), {}, 1000)[0].text).toMatch(/Through the short trigger ₹99\.00 — it counts once a 5-minute bar closes below it/);
});

test("the stop and the targets of an open trade", () => {
  const stop = checkWires(wiresFrom(long), 99.8, tick(99.4), {}, 1000).find((e) => e.id === "stop");
  expect(stop).toMatchObject({ kind: "stop", urgent: true, refresh: true, tone: "down" });
  expect(stop.text).toBe("Stop level ₹99.50 broken — the long idea is no longer valid.");
  expect(ids(checkWires(wiresFrom(long), 102.9, tick(103.1), {}, 1000))).toContain("target-1R");
  // rising through a long's stop level from below is not a stop-out
  expect(ids(checkWires(wiresFrom(long), 99.4, tick(99.8), {}, 1000))).not.toContain("stop");
  // a short is the mirror image
  expect(checkWires(wiresFrom(short), 100.2, tick(100.6), {}, 1000).find((e) => e.id === "stop").text).toMatch(/the short idea is no longer valid/);
  expect(ids(checkWires(wiresFrom(short), 97.2, tick(96.9), {}, 1000))).toContain("target-1R");
});

test("VWAP is compared with where it is on this tick, and other levels are noted", () => {
  const cfg = wiresFrom(waiting);
  // the verdict last saw VWAP at 100; it has since moved to 100.4
  expect(ids(checkWires(cfg, 100.1, tick(100.3, { avgPrice: 100.4 }), {}, 1000))).toEqual([]);
  const cross = checkWires(cfg, 100.3, tick(100.45, { avgPrice: 100.4 }), {}, 1000);
  expect(cross[0]).toMatchObject({ id: "vwap", tone: "up", refresh: true, urgent: false });
  expect(cross[0].text).toBe("Crossed above VWAP ₹100.40.");
  expect(checkWires(cfg, 102.9, tick(103.2), {}, 1000)[0].text).toBe("Crossed above the previous day high ₹103.00.");
});

test("a level that keeps being crossed does not ring every time", () => {
  const cfg = wiresFrom(waiting);
  const memo = {};
  expect(ids(checkWires(cfg, 99.9, tick(100.1), memo, 1000))).toEqual(["vwap"]);
  expect(ids(checkWires(cfg, 100.1, tick(99.9), memo, 5000))).toEqual([]); // 4 s later: quiet
  expect(ids(checkWires(cfg, 99.9, tick(100.1), memo, 9000))).toEqual([]);
  expect(ids(checkWires(cfg, 100.1, tick(99.9), memo, 25000))).toEqual(["vwap"]); // after 20 s it may speak again
});

test("closing in on a trigger or the stop is announced before it gets there — once", () => {
  const cfg = wiresFrom(waiting); // ATR 4 → the warning band is 0.32
  const memo = {};
  expect(ids(checkWires(cfg, 100.5, tick(100.6), memo, 1000))).toEqual([]);
  const near = checkWires(cfg, 100.6, tick(100.75), memo, 2000);
  expect(ids(near)).toEqual(["trigger-long-near"]);
  expect(near[0].text).toBe("Closing in on the long trigger ₹101.00 — ₹0.25 away.");
  expect(ids(checkWires(cfg, 100.75, tick(100.8), memo, 3000))).toEqual([]); // still near: said already
  // it backs off well away, then comes close again later
  checkWires(cfg, 100.8, tick(100.2), memo, 4000);
  expect(ids(checkWires(cfg, 100.2, tick(100.8), memo, 60000))).toEqual(["trigger-long-near"]);
  // the stop of an open long
  const nearStop = checkWires(wiresFrom(long), 100.2, tick(99.7), {}, 1000);
  expect(nearStop.find((e) => e.id === "stop-near").text).toMatch(/Closing in on the stop level ₹99\.50/);
});

test("a new high or low for the day, and nothing at all when the price has not moved", () => {
  const cfg = wiresFrom(waiting);
  const memo = {};
  expect(ids(checkWires(cfg, 100.2, tick(100.3, { high: 100.4, low: 99.6 }), memo, 1000))).toEqual([]); // the first tick only sets the marks
  expect(ids(checkWires(cfg, 100.3, tick(100.5, { high: 100.5, low: 99.6 }), memo, 2000))).toEqual(["day-high"]);
  expect(ids(checkWires(cfg, 100.5, tick(100.5, { high: 100.5, low: 99.6 }), memo, 3000))).toEqual([]);
  expect(ids(checkWires(cfg, null, tick(100.5), memo, 3000))).toEqual([]);
  // zeros before the first trade of the day are not a "new low"
  expect(ids(checkWires(cfg, 100.5, tick(100.45, { high: 100.5, low: 0 }), memo, 4000))).toEqual([]);
});
