import { act, render, screen } from "@testing-library/react";
import React from "react";
import { __reset, onTopics, resync, useLive } from "./live";
import { everyVisible } from "./visible";
import LiveBadge from "./LiveBadge";

class FakeES {
  static all = [];
  constructor(url) {
    this.url = url;
    this.l = {};
    this.closed = false;
    FakeES.all.push(this);
  }
  addEventListener(t, f) {
    (this.l[t] = this.l[t] || []).push(f);
  }
  close() {
    this.closed = true;
  }
  emit(type, data, id) {
    (this.l[type] || []).forEach((f) => f({ data: JSON.stringify(data), lastEventId: id ? String(id) : "" }));
  }
  open() {
    this.onopen && this.onopen();
  }
  fail() {
    this.onerror && this.onerror();
  }
}
const last = () => FakeES.all[FakeES.all.length - 1];

beforeEach(() => {
  jest.useFakeTimers();
  FakeES.all = [];
  global.EventSource = FakeES;
  __reset();
});
afterEach(() => {
  __reset();
  jest.useRealTimers();
  delete global.EventSource;
});

test("a subscriber hears only the topics it asked for; a resync reaches everyone", () => {
  const horizon = jest.fn();
  const everything = jest.fn();
  onTopics(["horizon"], horizon);
  onTopics(null, everything);
  expect(FakeES.all).toHaveLength(1); // one connection, however many subscribers
  expect(last().url).toBe("/api/admin/live");
  act(() => last().emit("hello", { boot: "b1", seq: 7 }));
  act(() => last().emit("change", { topic: "trading", via: "api" }, 8));
  act(() => last().emit("change", { topic: "horizon", via: "watch" }, 9));
  expect(horizon).toHaveBeenCalledTimes(1);
  expect(everything).toHaveBeenCalledTimes(2);
  act(() => last().emit("resync", { reason: "missed" }));
  expect(horizon).toHaveBeenCalledTimes(2);
  expect(horizon.mock.calls[1][1].reason).toBe("missed");
  resync("test");
  expect(horizon).toHaveBeenCalledTimes(3);
});

test("a dropped connection reconnects with growing pauses, says the last event it saw, and re-reads everything when the server restarted", () => {
  const fn = jest.fn();
  onTopics(["market"], fn);
  const first = last();
  act(() => first.emit("hello", { boot: "b1", seq: 3 }));
  act(() => first.emit("change", { topic: "market" }, 4));
  expect(fn).toHaveBeenCalledTimes(1);
  act(() => first.fail());
  expect(first.closed).toBe(true);
  act(() => jest.advanceTimersByTime(1000));
  const second = last();
  expect(second).not.toBe(first);
  expect(second.url).toBe("/api/admin/live?last=4&boot=b1");
  act(() => second.fail());
  act(() => jest.advanceTimersByTime(1999));
  expect(FakeES.all).toHaveLength(2); // the second pause is longer: 2 seconds
  act(() => jest.advanceTimersByTime(1));
  const third = last();
  expect(FakeES.all).toHaveLength(3);
  // the server came back as a new run: everything re-reads
  act(() => third.emit("hello", { boot: "b2", seq: 0 }));
  expect(fn).toHaveBeenCalledTimes(2);
});

test("the header says whether the live channel is up", () => {
  render(<LiveBadge />);
  expect(screen.getByRole("status").textContent).toMatch(/Connecting/);
  act(() => last().open());
  act(() => last().emit("hello", { boot: "b", seq: 1 }));
  expect(screen.getByRole("status").textContent).toMatch(/Live/);
  act(() => last().fail());
  expect(screen.getByRole("status").textContent).toMatch(/Reconnecting/);
  for (let i = 0; i < 3; i += 1) {
    act(() => jest.advanceTimersByTime(16000));
    act(() => last().fail());
  }
  expect(screen.getByRole("status").textContent).toMatch(/Offline/);
});

test("a poller tagged with topics runs the moment one changes — once for a burst — and still runs on its timer", () => {
  const fn = jest.fn();
  const stop = everyVisible(fn, 60000, { topics: ["horizon"] });
  act(() => last().emit("hello", { boot: "b", seq: 0 }));
  jest.advanceTimersByTime(1000); // not within the least gap of a run
  act(() => last().emit("change", { topic: "market" }, 1));
  expect(fn).toHaveBeenCalledTimes(0);
  act(() => last().emit("change", { topic: "horizon" }, 2));
  expect(fn).toHaveBeenCalledTimes(1);
  // a burst inside the gap becomes one more run, a moment later
  act(() => last().emit("change", { topic: "horizon" }, 3));
  act(() => last().emit("change", { topic: "horizon" }, 4));
  expect(fn).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(900));
  expect(fn).toHaveBeenCalledTimes(2);
  // the timer is the safety net
  act(() => jest.advanceTimersByTime(60000));
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
  act(() => last().emit("change", { topic: "horizon" }, 5));
  expect(fn).toHaveBeenCalledTimes(3);
});

test("useLive reports the connection to any component", () => {
  function Probe() {
    const l = useLive();
    return <span>{l.status}</span>;
  }
  render(<Probe />);
  expect(screen.getByText("connecting")).toBeTruthy();
});
