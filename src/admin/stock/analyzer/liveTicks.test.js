import { createHub, createStore } from "./liveTicks";

/** A stand-in for EventSource that records what was opened and lets a test push events. */
function sources() {
  const opened = [];
  const open = (url) => {
    const handlers = {};
    const s = { url, closed: false, addEventListener: (name, fn) => (handlers[name] = fn), close: () => (s.closed = true), emit: (name, data) => handlers[name] && handlers[name]({ data: JSON.stringify(data) }), onerror: null };
    opened.push(s);
    return s;
  };
  return { opened, open };
}
const symbolsOf = (s) => decodeURIComponent(s.url.split("symbols=")[1].split("&")[0]).split(",").sort();

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("the store tells only the label whose symbol ticked", () => {
  const store = createStore();
  const a = jest.fn();
  const b = jest.fn();
  store.subscribe("SBIN", a);
  const off = store.subscribe("INFY", b);
  store.set("SBIN", { last: 800 });
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  expect(store.get("SBIN").last).toBe(800);
  off();
  store.clear();
  expect(a).toHaveBeenCalledTimes(2);
  expect(store.get("SBIN")).toBeNull();
});

test("every part of the page shares one connection", () => {
  const { opened, open } = sources();
  const hub = createHub(open, 50);
  const desk = hub.newId();
  const dock = hub.newId();
  hub.want(desk, ["SBIN", "INFY"], "SBIN");
  hub.want(dock, ["RELIANCE", "SBIN"]);
  expect(opened).toHaveLength(0);
  jest.advanceTimersByTime(60);
  expect(opened).toHaveLength(1);
  expect(symbolsOf(opened[0])).toEqual(["INFY", "RELIANCE", "SBIN"]);
  expect(opened[0].url).toMatch(/&focus=SBIN$/);
  expect(hub.status().state).toBe("connecting");

  opened[0].emit("status", { state: "live" });
  opened[0].emit("tick", { s: "SBIN", last: 801 });
  expect(hub.status().state).toBe("live");
  expect(hub.store.get("SBIN").last).toBe(801);

  // the dock closes: the open stream already carries what is left, so it is kept
  hub.want(dock, []);
  jest.advanceTimersByTime(60);
  expect(opened).toHaveLength(1);
  expect(opened[0].closed).toBe(false);

  // a new symbol widens the stream; the prices on screen stay while it reconnects
  hub.want(dock, ["TCS"]);
  jest.advanceTimersByTime(60);
  expect(opened).toHaveLength(2);
  expect(opened[0].closed).toBe(true);
  expect(symbolsOf(opened[1])).toEqual(["INFY", "SBIN", "TCS"]);
  expect(hub.status().state).toBe("live");
  expect(hub.store.get("SBIN").last).toBe(801);
  // a late event from the closed stream is ignored
  opened[0].emit("tick", { s: "SBIN", last: 1 });
  expect(hub.store.get("SBIN").last).toBe(801);

  // opening another stock changes the focus (its order book travels with it)
  hub.want(desk, ["SBIN", "INFY"], "INFY");
  jest.advanceTimersByTime(60);
  expect(opened).toHaveLength(3);
  expect(opened[2].url).toMatch(/&focus=INFY$/);
});

test("when the stream is not live the polled prices take over, and nobody asking closes it", () => {
  const { opened, open } = sources();
  const hub = createHub(open, 50);
  const seen = [];
  hub.onStatus(() => seen.push(hub.status().state));
  const id = hub.newId();
  hub.want(id, ["SBIN"]);
  jest.advanceTimersByTime(60);
  opened[0].emit("status", { state: "live" });
  opened[0].emit("tick", { s: "SBIN", last: 800 });
  opened[0].emit("status", { state: "down", reason: "Zerodha's stream dropped." });
  expect(hub.store.get("SBIN")).toBeNull();
  expect(hub.status()).toEqual({ state: "down", reason: "Zerodha's stream dropped." });

  // the server refusing (not connected) closes the stream; the next request tries again
  opened[0].emit("status", { state: "off", reason: "Zerodha is not connected." });
  expect(opened[0].closed).toBe(true);
  hub.want(id, ["SBIN"]);
  jest.advanceTimersByTime(60);
  expect(opened).toHaveLength(2);

  // a dropped connection: the browser retries by itself, prices fall back meanwhile
  opened[1].emit("status", { state: "live" });
  opened[1].emit("tick", { s: "SBIN", last: 802 });
  opened[1].onerror();
  expect(hub.store.get("SBIN")).toBeNull();
  expect(hub.status().state).toBe("connecting");

  hub.want(id, []);
  jest.advanceTimersByTime(60);
  expect(opened[1].closed).toBe(true);
  expect(hub.status().state).toBe("off");
  expect(seen).toEqual(["connecting", "live", "down", "off", "connecting", "live", "connecting", "off"]);
});

test("a browser without streaming simply stays on polled prices", () => {
  const hub = createHub(() => null, 10);
  hub.want(hub.newId(), ["SBIN"]);
  jest.advanceTimersByTime(20);
  expect(hub.status().state).toBe("off");
});
