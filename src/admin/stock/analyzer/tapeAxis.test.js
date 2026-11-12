import { axisFor, clip, minOf, timeLabels, OPEN_MIN, CLOSE_MIN } from "./tapeAxis";

const bars = (from, n) =>
  Array.from({ length: n }, (_, i) => {
    const m = minOf(from) + i;
    return { t: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
  });

test("the whole session: 75 five-minute slots or 375 one-minute slots", () => {
  expect(axisFor(bars("09:15", 10), 5, 0)).toEqual({ from: OPEN_MIN, to: CLOSE_MIN, slots: 75 });
  expect(axisFor(bars("09:15", 10), 1, 0)).toEqual({ from: OPEN_MIN, to: CLOSE_MIN, slots: 375 });
  // a span longer than the day is the whole day
  expect(axisFor(bars("09:15", 10), 1, 600).slots).toBe(375);
});

test("a window ends just after the newest bar and never leaves the session", () => {
  // 09:15 … 11:14 → newest bar 11:14, two hours shown, ten minutes of room on the right
  const a = axisFor(bars("09:15", 120), 1, 120);
  expect(a.slots).toBe(120);
  expect(a.to).toBe(minOf("11:25"));
  expect(a.from).toBe(minOf("09:25"));
  // early in the day the window starts at the open
  const early = axisFor(bars("09:15", 20), 1, 60);
  expect(early).toEqual({ from: OPEN_MIN, to: OPEN_MIN + 60, slots: 60 });
  // at the close it stops at 3:30
  const late = axisFor(bars("09:15", 375), 1, 60);
  expect(late.to).toBe(CLOSE_MIN);
  expect(late.from).toBe(CLOSE_MIN - 60);
  // no bars at all still gives a valid axis
  expect(axisFor([], 1, 60).slots).toBe(60);
});

test("time labels: the familiar hours for the whole day, round times inside a window", () => {
  expect(timeLabels(OPEN_MIN, CLOSE_MIN).map((l) => l.label)).toEqual(["9:15", "10", "11", "12", "1", "2", "3", "3:30"]);
  expect(timeLabels(OPEN_MIN, CLOSE_MIN, true).map((l) => l.label)).toEqual(["9:15", "11", "1", "3:30"]);
  expect(timeLabels(minOf("09:25"), minOf("11:25")).map((l) => l.label)).toEqual(["9:30", "10:00", "10:30", "11:00"]);
  expect(timeLabels(minOf("13:10"), minOf("14:10")).map((l) => l.label)).toEqual(["1:15", "1:30", "1:45", "2:00"]);
  expect(timeLabels(minOf("13:10"), minOf("14:10"), true).map((l) => l.label)).toEqual(["1:30", "2:00"]);
});

test("zones are clipped to what is on screen", () => {
  expect(clip(555, 570, 555, 930)).toEqual([555, 570]);
  expect(clip(555, 570, 565, 685)).toEqual([565, 570]);
  expect(clip(555, 570, 600, 720)).toBeNull();
  expect(clip(885, 930, 800, 900)).toEqual([885, 900]);
});
