import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ZerodhaAccounts from "./ZerodhaAccounts";

const mockApi = jest.fn();
const mockAsk = jest.fn();
let mockUser = { role: "superadmin", email: "owner@example.com" };
// the page's address: the Kite login comes back as ?account=connected | error (the result is read once, then removed)
let mockSearch = "";
const mockSetParams = jest.fn();
jest.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams(mockSearch), mockSetParams] }));
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./auth", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("./dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));

const REDIRECT = "https://example.org/api/admin/accounts/kite/callback";
const people = {
  redirectUrl: REDIRECT,
  admins: ["asha@example.com", "ravi@example.com"],
  people: [{ email: "asha@example.com", allowed: true, listed: true, configured: true, connected: true, kiteUser: "ZZ9001", loginAt: "2026-11-19T03:50:00.000Z", tradingOn: false }],
};
const show = (search = "") => {
  mockSearch = search;
  return render(<ZerodhaAccounts />);
};

beforeEach(() => {
  mockApi.mockReset();
  mockAsk.mockReset();
  mockUser = { role: "superadmin", email: "owner@example.com" };
});

test("the owner sees who may trade on their own Zerodha account and whether it is connected — never a key, a position or an order", async () => {
  mockApi.mockResolvedValue(people);
  const { container } = show();
  await waitFor(() => expect(screen.getByText("asha@example.com")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/accounts");
  const rows = [...container.querySelectorAll(".za-list li")].map((li) => li.textContent);
  expect(rows[0]).toMatch(/asha@example\.com.*Connected · ZZ9001/);
  expect(rows[1]).toMatch(/ravi@example\.com.*Off/);
  expect(container.querySelector(".za-list li").className).toBe("is-ok");
  expect(screen.getAllByRole("checkbox", { name: "Own Zerodha account" }).map((c) => c.checked)).toEqual([true, false]);
  expect(container.textContent).toContain(REDIRECT);
  expect(container.textContent).toMatch(/never what is in it; nobody can place an order on an account that is not theirs/);
  expect(container.querySelector('input[type="password"]')).toBeNull();
});

test("switching a person on asks first, in plain words; switching off does not ask; “not now” changes nothing", async () => {
  mockApi.mockResolvedValue(people);
  show();
  await waitFor(() => expect(screen.getByText("ravi@example.com")).toBeTruthy());
  const [asha, ravi] = screen.getAllByRole("checkbox", { name: "Own Zerodha account" });
  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(ravi);
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(mockAsk.mock.calls[0][0].title).toBe("Let ravi@example.com trade on their own Zerodha account here?");
  expect(mockAsk.mock.calls[0][0].body).toMatch(/They cannot see or touch your account, and you cannot see or trade theirs/);
  expect(mockApi).toHaveBeenCalledTimes(1); // only the first read

  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(ravi);
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/admin/accounts/people/ravi%40example.com", { method: "PUT", body: { allowed: true } }));
  fireEvent.click(asha);
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/admin/accounts/people/asha%40example.com", { method: "PUT", body: { allowed: false } }));
  expect(mockAsk).toHaveBeenCalledTimes(2);
});

test("a person it is not switched on for is told so; one with a saved key logs in on Zerodha's own page", async () => {
  mockUser = { role: "admin", email: "ravi@example.com" };
  mockApi.mockResolvedValue({ allowed: false });
  const first = show();
  await waitFor(() => expect(screen.getByText(/is not switched on for you/)).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/accounts/me");
  expect(screen.queryByText("Log in to Kite")).toBeNull();
  first.unmount();

  mockApi.mockResolvedValue({ allowed: true, configured: true, connected: false, apiKeyHint: "demo…abcd", redirectUrl: REDIRECT });
  show();
  await waitFor(() => expect(screen.getByText("Not logged in today")).toBeTruthy());
  const login = screen.getByRole("link", { name: "Log in to Kite" });
  expect(login.getAttribute("href")).toBe("/api/admin/accounts/kite/login");
  expect(screen.getByText(/Key demo…abcd is saved/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Change the key" })).toBeTruthy();
});

test("a person with no key yet is walked through it: their own Kite Connect app, the redirect URL, the key and the secret — which is saved once and never shown", async () => {
  mockUser = { role: "admin", email: "asha@example.com", trader: true };
  mockApi.mockResolvedValue({ allowed: true, configured: false, connected: false, redirectUrl: REDIRECT });
  const { container } = show();
  await waitFor(() => expect(screen.getByText("No key yet")).toBeTruthy());
  expect(container.querySelector(".za-steps").textContent).toMatch(/your own.*Kite Connect app/);
  expect(container.querySelector(".za-steps").textContent).toContain(REDIRECT);
  expect(container.querySelector(".za-steps").textContent).toMatch(/static IP/);
  const [key, secret] = container.querySelectorAll(".za-fields input");
  expect(secret.type).toBe("password");
  fireEvent.change(key, { target: { value: " mykey123 " } });
  fireEvent.change(secret, { target: { value: "mysecret456" } });
  mockApi.mockResolvedValue({ allowed: true, configured: true, connected: false, apiKeyHint: "myke…y123", redirectUrl: REDIRECT });
  fireEvent.click(screen.getByRole("button", { name: "Save the key" }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/admin/accounts/me/kite", { method: "PUT", body: { apiKey: "mykey123", apiSecret: "mysecret456" } }));
  await waitFor(() => expect(screen.getByText("Not logged in today")).toBeTruthy());
  expect(container.textContent).not.toContain("mysecret456");
});

test("coming back from Zerodha's login, the result is said once", async () => {
  mockUser = { role: "admin", email: "asha@example.com", trader: true };
  mockApi.mockResolvedValue({ allowed: true, configured: true, connected: true, user: "Asha", userId: "ZZ9001", expiresAt: "2026-11-20T00:30:00.000Z", redirectUrl: REDIRECT });
  const ok = show("account=connected");
  await waitFor(() => expect(screen.getByText("Connected as Asha (ZZ9001)")).toBeTruthy());
  expect(screen.getByRole("status").textContent).toBe("Your Zerodha account is connected until 6 AM tomorrow.");
  expect(screen.getByRole("link", { name: "Open Positions" }).getAttribute("href")).toMatch(/stock-report\?view=account$/);
  expect(mockSetParams).toHaveBeenCalled(); // the result leaves the address, so a reload does not say it again
  ok.unmount();
  show("account=error&reason=The%20login%20was%20cancelled.");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("The login was cancelled."));
});
