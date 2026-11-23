import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AccountMenu, { roleLabel } from "./AccountMenu";
import { api } from "./api";

jest.mock("./api", () => ({ api: jest.fn() }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});
let mockUser = null;
jest.mock("./auth", () => ({ useAuth: () => ({ user: mockUser }) }));

const renderMenu = (extra) =>
  render(
    <AccountMenu extra={extra} />
  );

beforeEach(() => {
  mockUser = { name: "Sample Owner", email: "owner@example.com", role: "superadmin", owner: true, picture: "" };
});

test("the header shows only the photo (or initial); pressing it opens full name, email, role, My profile and Sign out", async () => {
  api.mockImplementation(async () => ({ ok: true }));
  const assign = jest.fn();
  delete window.location;
  window.location = { assign };
  renderMenu();
  const btn = screen.getByRole("button", { name: "Account menu: Sample Owner" });
  expect(btn.textContent).toBe("S"); // the initial, not the full name
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(btn);
  const menu = screen.getByRole("menu", { name: "Account" });
  expect(menu.textContent).toMatch(/Sample Owner/);
  expect(menu.textContent).toMatch(/owner@example\.com/);
  expect(within(menu).getByText("Owner")).toBeTruthy();
  expect(within(menu).getByRole("menuitem", { name: "My profile" }).getAttribute("href")).toBe("/me/account");
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/me"));
});

test("keyboard: ↓ opens it on the first item, ↑ ↓ move, Escape closes and returns to the photo; a press elsewhere closes it", () => {
  renderMenu((close) => (
    <button type="button" role="menuitem" className="acm__item" onClick={close}>
      Dashboard
    </button>
  ));
  const btn = screen.getByRole("button", { name: /Account menu/ });
  btn.focus();
  fireEvent.keyDown(btn, { key: "ArrowDown" });
  return waitFor(() => expect(document.activeElement.textContent).toMatch(/My profile/)).then(() => {
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement.textContent).toBe("Dashboard"); // the page's own item sits between
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement.textContent).toMatch(/Hide amounts/); // the switch is in every account menu
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement.textContent).toMatch(/Sign out/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

test("roles in words, and a photo when there is one", () => {
  expect([roleLabel({ owner: true, role: "superadmin" }), roleLabel({ role: "superadmin" }), roleLabel({ role: "admin" }), roleLabel(null)]).toEqual(["Owner", "Superadmin", "Admin", ""]);
  mockUser = { name: "Pic Person", email: "p@example.com", role: "admin", picture: "https://example.com/p.png" };
  renderMenu();
  expect(screen.getByRole("button", { name: /Account menu: Pic Person/ }).querySelector("img").getAttribute("src")).toBe("https://example.com/p.png");
});
