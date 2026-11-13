import React from "react";
import { act, render, screen } from "@testing-library/react";
import { AuthContext } from "./auth";
import Dashboard from "./Dashboard";

jest.mock("./api", () => ({ api: () => Promise.resolve({}) }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
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
  expect(screen.getByText("Advisor").closest("a").getAttribute("href")).toBe("/me/stock-report?view=advisor");
  expect(screen.getByText("Positions").closest("a").getAttribute("href")).toBe("/me/stock-report?view=account");
});

test("an admin who is not the owner does not get the account workspaces", async () => {
  render(page("admin"));
  await settle();
  expect(screen.queryByText("Positions")).toBeNull();
  expect(screen.queryByText("Journal")).toBeNull();
  expect(screen.getByText("Advisor")).toBeTruthy();
});
