import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AiBrain from "./AiBrain";
import { api } from "../../api";

// every read stays pending: the card shows its loading lines, which is all these tests need
// (the project's Jest setup resets mock implementations before each test, so it is set again there)
jest.mock("../../api", () => ({ api: jest.fn() }));
beforeEach(() => api.mockImplementation(() => new Promise(() => {})));

const KEY = "vpt.desk.brain";
const plan = () => screen.queryByText("Building the intraday plan…");

describe("AiBrain on the Desk (foldable)", () => {
  beforeEach(() => window.localStorage.clear());

  test("starts folded: the chips show, the full reading does not", () => {
    render(<AiBrain symbol="SBIN" live={false} marketHours={false} foldable />);
    const fold = screen.getByRole("button", { name: /details/i });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(plan()).toBeNull();
    // the summary chips are always there
    expect(screen.getByRole("button", { name: "Show the next-session read" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show the intraday plan for the next session" })).toBeTruthy();
  });

  test("Details opens the reading, Hide folds it, and the choice is remembered", () => {
    render(<AiBrain symbol="SBIN" live={false} marketHours={false} foldable />);
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(plan()).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBe("open");
    const hide = screen.getByRole("button", { name: /hide/i });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    expect(plan()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("closed");
  });

  test("opens by itself when it was left open on this device", () => {
    window.localStorage.setItem(KEY, "open");
    render(<AiBrain symbol="SBIN" live={false} marketHours={false} foldable />);
    expect(plan()).toBeTruthy();
  });

  test("a chip opens its own reading; pressing it again folds it away", () => {
    render(<AiBrain symbol="SBIN" live={false} marketHours={false} foldable />);
    const chip = screen.getByRole("button", { name: "Show the next-session read" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Reading the numbers…")).toBeTruthy();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Reading the numbers…")).toBeNull();
  });
});

describe("AiBrain elsewhere (not foldable)", () => {
  beforeEach(() => window.localStorage.clear());

  test("always shows its reading and has no fold button", () => {
    render(<AiBrain symbol="SBIN" live={false} marketHours={false} />);
    expect(plan()).toBeTruthy();
    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
  });
});
