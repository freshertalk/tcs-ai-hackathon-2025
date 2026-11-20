import React from "react";
import { act, render, screen } from "@testing-library/react";
import { AuthContext } from "./auth";
import Dashboard from "./Dashboard";

jest.mock("./api", () => ({ api: () => Promise.resolve({}) }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children), useSearchParams: () => [new URLSearchParams(), () => {}] };
});

const page = (role) => (
  <AuthContext.Provider value={{ loading: false, user: { email: "someone@example.com", name: "Test Person", picture: "", role }, reload() {} }}>
    <div className="adm">
      <Dashboard />
    </div>
  </AuthContext.Provider>
);
const settle = () => act(async () => Promise.resolve());

test("the dashboard opens straight away: no welcome picture, no sound, no private-access card", async () => {
  render(page("admin"));
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(/Namaste, Test/)).toBeTruthy();
  expect(screen.queryByText(/Personal Access/i)).toBeNull();
  expect(screen.queryByText("someone@example.com")).toBeNull();
});

test("the Stock Report is the main way in, with a direct link to each workspace", async () => {
  render(page("superadmin"));
  await settle();
  const main = screen.getByText("Open the terminal").closest("a");
  expect(main.getAttribute("href")).toBe("/me/stock-report");
  expect(main.getAttribute("target")).toBe("_blank");
  // (the Customize card names the workspaces too: the LINK is the one in the Workspaces list)
  const linkOf = (text) => screen.getAllByText(text).map((el) => el.closest("a")).find(Boolean);
  expect(linkOf("Advisor").getAttribute("href")).toBe("/me/stock-report?view=advisor");
  expect(linkOf("Positions").getAttribute("href")).toBe("/me/stock-report?view=account");
});

test("an admin who is not the owner does not get the account workspaces", async () => {
  render(page("admin"));
  await settle();
  expect(screen.queryByText("Positions")).toBeNull();
  expect(screen.queryByText("Journal")).toBeNull();
  expect(screen.getAllByText("Advisor").some((el) => el.closest("a"))).toBe(true);
});

test("the Social Media tile opens its page in a new tab", async () => {
  render(page("admin"));
  await settle();
  const a = screen.getByText("Open Social Media").closest("a");
  expect(a.getAttribute("href")).toBe("/me/social");
  expect(a.getAttribute("target")).toBe("_blank");
});

test("the status row, the owner's Today cards and the three tiles are there; an admin who is not the owner has no Today cards", async () => {
  render(page("superadmin"));
  await settle();
  const row = screen.getByLabelText("Status");
  expect(row.textContent).toMatch(/NSE session/);
  expect(row.textContent).toMatch(/Zerodha/);
  expect(row.textContent).toMatch(/AI credit/);
  expect(row.textContent).toMatch(/15-min forecast/);
  expect(screen.getByText("Today at a glance")).toBeTruthy();
  expect(screen.getByText("Autopilot")).toBeTruthy();
  expect(screen.getByText("Open TradeAI").closest("a").getAttribute("href")).toBe("/me/tradeai");
  expect(screen.getByText("Open paper trading").closest("a").getAttribute("href")).toBe("/me/stock-report?view=paper");
  // the section's heading, and the same name in the side column's list of sections
  expect(screen.getByRole("heading", { name: "Settings & system" })).toBeTruthy();
});

test("an admin who is not the owner sees no Today cards and no owner-only status", async () => {
  render(page("admin"));
  await settle();
  expect(screen.queryByText("Today at a glance")).toBeNull();
  expect(screen.getByLabelText("Status").textContent).not.toMatch(/Trading switch|P&L/);
});
