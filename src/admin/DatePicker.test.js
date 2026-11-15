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
