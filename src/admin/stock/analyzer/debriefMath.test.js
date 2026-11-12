import { fmtR, lanes, nearest, rAxis, stepLine } from "./debriefMath";

test("R is written with a sign and a real minus", () => {
  expect(fmtR(1.25)).toBe("+1.25 R");
  expect(fmtR(-0.4)).toBe("−0.40 R");
  expect(fmtR(0)).toBe("0.00 R");
  expect(fmtR(2, 0)).toBe("+2 R");
  expect(fmtR(null)).toBe("—");
  expect(fmtR(NaN)).toBe("—");
});

test("the R axis always holds zero and ends on round numbers", () => {
  expect(rAxis([-1.42, -0.81, -0.65])).toEqual({ lo: -1.5, hi: 0, step: 0.5, ticks: [-1.5, -1, -0.5, 0] });
  expect(rAxis([0.6, 1.6, 3.2]).ticks).toEqual([0, 1, 2, 3, 4]);
  expect(rAxis([-6.3, 4.1]).ticks).toEqual([-10, -5, 0, 5]);
  // a flat or empty day still gets a scale
  expect(rAxis([]).ticks).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
  expect(rAxis([0.1]).ticks).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
  for (const vals of [[12.4], [-0.05, 0.05], [3, -3], [100, -40]]) {
    const a = rAxis(vals);
    expect(a.ticks).toContain(0);
    expect(a.lo).toBeLessThanOrEqual(Math.min(0, ...vals));
    expect(a.hi).toBeGreaterThanOrEqual(Math.max(0, ...vals));
    expect(a.ticks.length).toBeLessThanOrEqual(8);
  }
});

test("the running total starts at zero at the open and jumps when a call ends", () => {
  const curve = [
    { t: "10:00", total: -1.42 },
    { t: "10:35", total: -0.81 },
    { t: "15:15", total: -0.65 },
  ];
  const pts = stepLine(curve, 555);
  expect(pts.map((p) => [p.min, p.total])).toEqual([
    [555, 0],
    [600, -1.42],
    [635, -0.81],
    [915, -0.65],
  ]);
  expect(pts[0].call).toBeNull();
  expect(pts[2].call).toBe(curve[1]);
  expect(stepLine([], 555)).toEqual([{ min: 555, total: 0, call: null }]);
});

test("the engine's side through the day becomes stretches of time, merged while nothing changes", () => {
  const steps = [
    { t: "09:20", state: "no-trade" },
    { t: "09:30", state: "wait" },
    { t: "09:35", state: "wait-long" },
    { t: "09:40", state: "wait-long" },
    { t: "09:45", state: "long" },
    { t: "09:50", state: "long" },
    { t: "09:55", state: "wait" },
    { t: "10:00", state: "short" },
    { t: "10:05", state: "closed" },
  ];
  expect(lanes(steps)).toEqual([
    { side: "long", kind: "wait", from: 575, to: 585 },
    { side: "long", kind: "play", from: 585, to: 595 },
    { side: "short", kind: "play", from: 600, to: 605 },
  ]);
  // the last reading stands for one more bar
  expect(lanes([{ t: "15:25", state: "long" }])).toEqual([{ side: "long", kind: "play", from: 925, to: 930 }]);
  expect(lanes([])).toEqual([]);
});

test("the pointer snaps to the nearest point in time", () => {
  const pts = [{ min: 555 }, { min: 600 }, { min: 635 }, { min: 915 }];
  expect(nearest(pts, 540)).toBe(0);
  expect(nearest(pts, 610)).toBe(1);
  expect(nearest(pts, 620)).toBe(2);
  expect(nearest(pts, 2000)).toBe(3);
  expect(nearest([], 600)).toBe(-1);
});
