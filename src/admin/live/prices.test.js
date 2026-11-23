import React from "react";
import { render } from "@testing-library/react";
import { Flash, liveRow } from "./prices";

test("a row takes the live price and change when there is a tick; without one it stands as it was", () => {
  const row = { symbol: "SBIN", last: 800, changePct: 0.5, name: "State Bank" };
  expect(liveRow(row, {})).toBe(row);
  expect(liveRow(row, { SBIN: { last: 0 } })).toBe(row);
  expect(liveRow(row, { SBIN: { last: 812.4, changePct: 2.03 } })).toEqual({ symbol: "SBIN", last: 812.4, changePct: 2.03, name: "State Bank", live: true });
  expect(liveRow(row, { SBIN: { last: 808, prevClose: 800 } }).changePct).toBe(1);
  expect(liveRow({ s: "TCS", last: 1 }, { TCS: { last: 2, changePct: 100 } }, "s").last).toBe(2);
});

test("a value that moves flashes up or down; an unchanged one does not", () => {
  const { container, rerender } = render(<Flash value={100}>100</Flash>);
  expect(container.firstChild.className).toBe("lv-flash");
  rerender(<Flash value={101}>101</Flash>);
  expect(container.firstChild.className).toBe("lv-flash is-up");
  rerender(<Flash value={99}>99</Flash>);
  expect(container.firstChild.className).toBe("lv-flash is-down");
});
