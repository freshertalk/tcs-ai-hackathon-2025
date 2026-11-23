import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CustomizeCard from "./CustomizeCard";

const mockSave = jest.fn();
const mockReset = jest.fn();
const mockAsk = jest.fn();
let mockUser = { role: "superadmin" };
let mockPrefs;
jest.mock("./api", () => ({ api: jest.fn() }));
jest.mock("./auth", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("./dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));
jest.mock("./prefs", () => {
  const real = jest.requireActual("./prefs");
  return { ...real, usePrefs: () => ({ prefs: real.fillPrefs(mockPrefs), save: mockSave, reset: mockReset, saving: false, error: "", ready: true }) };
});

beforeEach(() => {
  mockSave.mockReset();
  mockReset.mockReset();
  mockAsk.mockReset();
  mockUser = { role: "superadmin" };
  mockPrefs = null;
});

const names = () => [...screen.getByRole("list", { name: /Workspaces, in the terminal's order/ }).querySelectorAll("li")].map((li) => li.textContent.replace(/[↑↓\s]+$/g, "").trim());

test("the look: each choice is saved the moment it is made, and the one that is on is marked", () => {
  mockPrefs = { accent: "teal", text: "large" };
  render(<CustomizeCard />);
  expect(screen.getByText("Saved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  expect(mockSave).toHaveBeenLastCalledWith({ theme: "light" });
  expect(screen.getByRole("button", { name: "Teal" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Violet" }));
  expect(mockSave).toHaveBeenLastCalledWith({ accent: "violet" });
  fireEvent.click(screen.getByRole("button", { name: "Teal" }));
  expect(mockSave).toHaveBeenCalledTimes(2); // choosing what is already on saves nothing
  // compact is the default since 24 Nov 2026: it is already on, and Comfortable gives the room back
  expect(screen.getByRole("button", { name: "Compact" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Comfortable" }));
  expect(mockSave).toHaveBeenLastCalledWith({ density: "comfortable" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pages and cards ease into place" }));
  expect(mockSave).toHaveBeenLastCalledWith({ motion: false });
});

test("the workspaces: yours to order and to hide — the Desk always stays, and a hidden one cannot be where the terminal opens", () => {
  mockPrefs = { nav: { order: ["research", "analyzer"], hidden: ["paper"] }, start: "advisor" };
  render(<CustomizeCard />);
  // (Now, the command screen, is the first workspace nobody has ranked yet)
  expect(names().slice(0, 5)).toEqual(["Research", "Desk", "Now", "Trade setup", "Advisor"]); // Trade setup joined on 23 Nov 2026
  expect(screen.getByText(/15 of 16 shown/)).toBeTruthy(); // Vinaypedia joined on 23 Nov 2026
  expect(screen.getByRole("checkbox", { name: "Desk" }).disabled).toBe(true);
  expect(screen.getByRole("checkbox", { name: "Paper" }).checked).toBe(false);
  // hiding the workspace the terminal opens on sends it back to the Desk
  fireEvent.click(screen.getByRole("checkbox", { name: "Advisor" }));
  expect(mockSave).toHaveBeenLastCalledWith({ nav: { hidden: ["paper", "advisor"] }, start: "analyzer" });
  // showing one again
  fireEvent.click(screen.getByRole("checkbox", { name: "Paper" }));
  expect(mockSave).toHaveBeenLastCalledWith({ nav: { hidden: [] } });
  // the arrows move a workspace one place; the whole order is saved
  fireEvent.click(screen.getByRole("button", { name: "Move Desk up" }));
  expect(mockSave.mock.calls[mockSave.mock.calls.length - 1][0].nav.order.slice(0, 5)).toEqual(["analyzer", "research", "now", "setup", "advisor"]);
  expect(screen.getByRole("button", { name: "Move Research up" }).disabled).toBe(true);
  // where the terminal opens: only a workspace that is shown
  const opens = screen.getByRole("combobox", { name: /The workspace the terminal opens on/ });
  expect([...opens.options].map((o) => o.textContent)).not.toContain("Paper");
  fireEvent.change(opens, { target: { value: "research" } });
  expect(mockSave).toHaveBeenLastCalledWith({ start: "research" });
});

test("a person sees only the workspaces their role allows; their own Zerodha account adds Positions and nothing else", () => {
  mockUser = { role: "admin" };
  const first = render(<CustomizeCard />);
  expect(names()).not.toContain("Positions");
  expect(names()).not.toContain("Journal");
  expect(names()).not.toContain("Trade Analysis");
  expect(screen.getByText(/13 of 13 shown/)).toBeTruthy();
  expect(names()).toContain("Vinaypedia");
  first.unmount();
  mockUser = { role: "admin", trader: true };
  render(<CustomizeCard />);
  expect(names()).toContain("Positions");
  expect(names()).not.toContain("Journal");
});

test("the Desk's start is saved and applied to this device at once; “Put everything back” asks first", async () => {
  render(<CustomizeCard />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Open when the Desk opens" }));
  expect(mockSave).toHaveBeenLastCalledWith({ desk: { board: false } }, { desk: true });
  fireEvent.click(within(screen.getByRole("group", { name: "Positions dock" })).getByRole("button", { name: "Closed" }));
  expect(mockSave).toHaveBeenLastCalledWith({ desk: { dock: "closed" } }, { desk: true });
  fireEvent.click(screen.getByRole("checkbox", { name: "Today" }));
  expect(mockSave).toHaveBeenLastCalledWith({ home: { today: false } });

  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Put everything back" }));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(mockAsk.mock.calls[0][0].body).toMatch(/no data, no settings, no account/);
  expect(mockReset).not.toHaveBeenCalled();
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Put everything back" }));
  await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
});
