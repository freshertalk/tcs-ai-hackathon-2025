import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthContext } from "./auth";
import Dashboard from "./Dashboard";

// The dashboard only asks the server for status badges; none of that matters here.
// (A plain function, not jest.fn: this project's runner resets mock functions before each test.)
jest.mock("./api", () => ({ api: () => Promise.resolve({}) }));
// The router package cannot be loaded by this project's test runner (it resolves its own
// files in a way the runner predates). The dashboard only needs its links, so a plain
// anchor stands in for them here.
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});

const user = { email: "someone@example.com", name: "Test Person", picture: "", role: "admin" };
const Page = () => (
  <AuthContext.Provider value={{ loading: false, user, reload() {} }}>
    <div className="adm">
      <Dashboard />
    </div>
  </AuthContext.Provider>
);
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

describe("the welcome on the dashboard", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
    // no recording on the "server", and this test browser cannot speak: the mantra is silent here
    global.fetch = () => Promise.resolve({ ok: false, headers: { get: () => "" } });
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  test("it opens every time the dashboard opens — nothing in the address is needed — and closes by itself", async () => {
    const first = render(<Page />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
    expect(screen.getByAltText("Shri Ram Darbar")).toBeTruthy();
    expect(screen.getByText("ॐ श्री गणेशाय नमः")).toBeTruthy();
    // it stays long enough to be looked at…
    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // …then makes way for the dashboard
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Namaste, Test/)).toBeTruthy();
    first.unmount();

    // opening the dashboard again shows it again
    render(<Page />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
  });

  test("Enter closes it at once, and the ॐ button brings it back", async () => {
    render(<Page />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the welcome again" }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
  });

  test("with the sound switched off it still shows, says so, and still closes by itself", async () => {
    window.localStorage.setItem("vpt.welcome.muted", "1");
    render(<Page />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
    expect(screen.getByText("Sound is off.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    act(() => {
      jest.advanceTimersByTime(9000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
