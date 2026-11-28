import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DateField, DateRangeField, TimeField, fmtDate } from "./DatePicker";

function One({ start = "2026-03-10", max }) {
  const [v, setV] = useState(start);
  return (
    <>
      <DateField value={v} onChange={setV} label="Day" max={max} />
      <output data-testid="v">{v}</output>
    </>
  );
}
function Range() {
  const [v, setV] = useState({ from: "", to: "" });
  return (
    <>
      <DateRangeField value={v} onChange={setV} label="Dates" />
      <output data-testid="r">{`${v.from}|${v.to}`}</output>
    </>
  );
}

test("a date field opens a Google-style calendar, picks a day with OK, and Cancel keeps the old one", () => {
  render(<One />);
  expect(screen.getByRole("button", { name: /Day 10 Mar 2026/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("March 2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Tuesday, 17 Mar 2026/ }));
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByTestId("v").textContent).toBe("2026-03-17");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  fireEvent.click(screen.getByRole("button", { name: /Wednesday, 25 Mar 2026/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByTestId("v").textContent).toBe("2026-03-17");
});

test("the keyboard moves through the days and months; days past the limit cannot be picked; years open in a grid", () => {
  render(<One start="2026-03-10" max="2026-03-20" />);
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  const dialog = screen.getByRole("dialog");
  act(() => {
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
  });
  act(() => {
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
  });
  expect(document.activeElement.getAttribute("data-day")).toBe("2026-03-18");
  expect(screen.getByRole("button", { name: /Saturday, 21 Mar 2026/ }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Next month" }).disabled).toBe(true);
  fireEvent.click(screen.getByText("March 2026"));
  expect(screen.getByRole("listbox", { name: "Year" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a range: the first click starts it, the second ends it (in either order), OK gives both days", () => {
  render(<Range />);
  fireEvent.click(screen.getByRole("button", { name: /Dates/ }));
  const days = screen.getAllByRole("button").filter((b) => b.getAttribute("data-day"));
  const a = days[14];
  const b = days[4];
  fireEvent.click(a);
  fireEvent.click(b); // before the first: they swap
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  const [from, to] = screen.getByTestId("r").textContent.split("|");
  expect(from).toBe(b.getAttribute("data-day"));
  expect(to).toBe(a.getAttribute("data-day"));
  expect(screen.getByRole("button", { name: new RegExp(`${fmtDate(from)} – ${fmtDate(to)}`) })).toBeTruthy();
});

test("a time field gives HH:MM from two selects", () => {
  let out = "";
  render(<TimeField value="09:15" onChange={(v) => (out = v)} label="Time" />);
  fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "14" } });
  expect(out).toBe("14:15");
  fireEvent.change(screen.getByLabelText("Minute"), { target: { value: "40" } });
  expect(out).toBe("09:40");
});

test("the arrows turn the month and it stays turned, back and forward, and after picking a year", () => {
  render(<One start="2023-11-30" />);
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  const prev = () => screen.getByRole("button", { name: "Previous month" });
  const next = () => screen.getByRole("button", { name: "Next month" });
  fireEvent.click(prev());
  expect(screen.getByText("October 2023")).toBeTruthy();
  fireEvent.click(prev());
  expect(screen.getByText("September 2023")).toBeTruthy();
  fireEvent.click(next());
  fireEvent.click(next());
  fireEvent.click(next());
  fireEvent.click(next());
  expect(screen.getByText("January 2024")).toBeTruthy();
  // turning the page picks nothing: the chosen day is still the old one
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByTestId("v").textContent).toBe("2023-11-30");
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  fireEvent.click(screen.getByText("November 2023"));
  fireEvent.click(screen.getByRole("option", { name: "2025" }));
  fireEvent.click(next());
  expect(screen.getByText("December 2025")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Wednesday, 3 Dec 2025/ }));
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.getByTestId("v").textContent).toBe("2025-12-03");
});

test("an arrow keeps the keyboard on itself; a keyboard move into another month takes the focus with it", () => {
  render(<One start="2026-03-31" />);
  fireEvent.click(screen.getByRole("button", { name: /Day/ }));
  const next = screen.getByRole("button", { name: "Next month" });
  act(() => next.focus());
  fireEvent.click(next);
  expect(screen.getByText("April 2026")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next month" }));
  act(() => document.querySelector('[data-day="2026-04-30"]').focus());
  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  });
  expect(screen.getByText("May 2026")).toBeTruthy();
  expect(document.activeElement.getAttribute("data-day")).toBe("2026-05-01");
});

test("a calendar that opens before its first allowed day starts at that day, and the arrows still work", () => {
  render(<DateField value="2026-01-10" min="2026-05-15" onChange={() => {}} label="Later" />);
  fireEvent.click(screen.getByRole("button", { name: /Later/ }));
  expect(screen.getByText("May 2026")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous month" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("June 2026")).toBeTruthy();
});

test("inside a form label, a click on the calendar's blank parts does not close it", () => {
  render(
    <label>
      <One start="2026-03-10" />
    </label>
  );
  fireEvent.click(document.querySelector(".dp-input"));
  fireEvent.click(screen.getByText("Tue, 10 Mar"));
  expect(screen.queryByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeTruthy();
});
