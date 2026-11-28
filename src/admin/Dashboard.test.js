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

test("Personal holds the Kundali tile, in Hindi, and the Expenses tile, each opening in a new tab — for superadmins only", async () => {
  const { unmount } = render(page("superadmin"));
  await settle();
  expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
  const spend = screen.getByText("Expenses").closest("a");
  expect([spend.getAttribute("href"), spend.getAttribute("target"), spend.getAttribute("rel")]).toEqual(["/me/expenses", "_blank", "noopener noreferrer"]);
  expect(spend.textContent).toMatch(/Track what you spend: by day, month, year and category/);
  const tile = screen.getByText("जन्म कुंडली").closest("a");
  expect(tile.getAttribute("href")).toBe("/me/kundali");
  expect(tile.getAttribute("target")).toBe("_blank");
  expect(tile.getAttribute("rel")).toBe("noopener noreferrer");
  expect(tile.getAttribute("lang")).toBe("hi");
  expect(tile.textContent).toMatch(/लग्न, ग्रह, दशा, योग, शुभ रंग और उपाय/);
  unmount();

  // an admin has no Personal block and no way in to either
  render(page("admin"));
  await settle();
  expect(screen.queryByRole("heading", { name: "Personal" })).toBeNull();
  expect(screen.queryByText("जन्म कुंडली")).toBeNull();
  expect(document.querySelector('a[href="/me/kundali"]')).toBeNull();
  expect(document.querySelector('a[href="/me/expenses"]')).toBeNull();
});

test("the page's sections are tabs under the header, and the owner's Personal things come last", async () => {
  render(page("superadmin"));
  await settle();
  const tabs = [...screen.getByRole("navigation", { name: "The sections of this page" }).querySelectorAll("button")].map((b) => b.textContent);
  expect(tabs).toEqual(expect.arrayContaining(["Overview", "Today", "Workspaces", "Settings & system", "Personal"]));
  expect(tabs[0]).toBe("Overview");
  expect(tabs[tabs.length - 1]).toBe("Personal");
  const main = document.querySelector(".hm.hm--kite .hm-main");
  // the greeting, the ways in and the tabs are the top of the page; nothing is drawn above them
  expect(main.parentElement.firstElementChild.classList.contains("hm-top")).toBe(true);
  expect(main.lastElementChild.getAttribute("aria-labelledby")).toBe("hm-about-h");
});
