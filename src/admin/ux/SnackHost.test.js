import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SnackHost from "./SnackHost";
import { closeSnack, snack } from "./snack";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("notes stack (three on screen), renew instead of repeating, leave by themselves, hold while hovered, and carry one action", () => {
  render(<SnackHost />);
  act(() => snack("Saved.", { tone: "ok" }));
  expect(screen.getByRole("status").textContent).toMatch(/Saved\./);
  act(() => snack("Saved.", { tone: "ok" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByText(/×2/)).toBeTruthy();
  const undo = jest.fn();
  act(() => snack("Order proposal dismissed.", { action: { label: "Undo", onClick: undo } }));
  act(() => snack("Could not reach Zerodha.", { tone: "error" }));
  act(() => snack("Fourth note."));
  expect(screen.getByRole("alert").textContent).toMatch(/Could not reach Zerodha/);
  expect(screen.getByText("1 more waiting")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByText("Order proposal dismissed.")).toBeNull();
  expect(screen.getByText("Fourth note.")).toBeTruthy();
  // hovering holds a note; leaving lets its clock run again
  const fourth = screen.getByText("Fourth note.").closest(".ux-snack");
  fireEvent.mouseEnter(fourth);
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText("Fourth note.")).toBeTruthy();
  fireEvent.mouseLeave(fourth);
  act(() => jest.advanceTimersByTime(29000));
  expect(screen.getByText("Fourth note.")).toBeTruthy(); // 30 seconds by default
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.queryByText("Fourth note.")).toBeNull();
  expect(screen.queryByText(/Saved\./)).toBeNull();
});

test("going offline is said until the connection is back; a keyed note can be closed from anywhere", () => {
  render(<SnackHost />);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.getByText(/You are offline/)).toBeTruthy();
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText(/You are offline/)).toBeTruthy();
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.queryByText(/You are offline/)).toBeNull();
  expect(screen.getByText(/Back online/)).toBeTruthy();
  act(() => snack("Working…", { key: "job", ms: 0 }));
  act(() => closeSnack("job"));
  expect(screen.queryByText("Working…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close this note" }));
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByText(/Back online/)).toBeNull();
});
