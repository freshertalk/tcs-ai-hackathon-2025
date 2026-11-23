import React from "react";
import { render, screen } from "@testing-library/react";
import Account from "./Account";
import { api } from "./api";

jest.mock("./api", () => ({ api: jest.fn() }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});
jest.mock("./auth", () => ({ useAuth: () => ({ user: { name: "Sample Owner", email: "owner@example.com", role: "superadmin", owner: true }, reload: () => {} }) }));
jest.mock("./Shell", () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock("./dialog/DialogProvider", () => ({ useDialog: () => jest.fn() }));

test("My profile: the band (name, email, role, last sign-in, Sign out), how you sign in, the password, devices and a timeline", async () => {
  api.mockImplementation(async () => ({
    email: "owner@example.com",
    name: "Sample Owner",
    role: "superadmin",
    hasPassword: true,
    passwordAt: "2026-11-20T10:00:00Z",
    googleLinked: true,
    emailVerified: false,
    lastLogin: "2026-11-24T04:00:00Z",
    methods: { password: true, google: true, code: true },
    canSetPasswordDirectly: false,
    activity: [
      { type: "signin", at: "2026-11-24T04:00:00Z", method: "google" },
      { type: "signin_failed", at: "2026-11-23T04:00:00Z", method: "password" },
      { type: "code_sent", at: "2026-11-22T04:00:00Z" },
    ],
  }));
  const { container } = render(
    <Account />
  );
  expect(await screen.findByRole("heading", { name: "Sample Owner", level: 2 })).toBeTruthy();
  expect(container.querySelector(".acp-hero__mail").textContent).toBe("owner@example.com");
  expect(container.querySelector(".acp-role").textContent).toBe("Owner");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  const methods = [...container.querySelectorAll(".acp-method")].map((li) => [li.querySelector("b").textContent, li.classList.contains("is-on")]);
  expect(methods).toEqual([["Google", true], ["Password", true], ["Email", false]]);
  expect(screen.getByRole("heading", { name: "Change your password" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out of every device" })).toBeTruthy();
  expect([...container.querySelectorAll(".acp-ev")].map((li) => li.className)).toEqual(["acp-ev acp-ev--ok", "acp-ev acp-ev--bad", "acp-ev acp-ev--info"]);
});
