import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "./auth";
import Login from "./Login";
import ResetPassword, { passwordRules } from "./ResetPassword";

const mockApi = jest.fn();
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return {
    Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children),
    useSearchParams: () => [new URLSearchParams(global.__search || "")],
  };
});

const door = (auth = {}) => {
  const reload = jest.fn();
  const ui = (
    <AuthContext.Provider value={{ loading: false, user: null, methods: { google: true, password: true, code: true }, emailReady: true, reload, ...auth }}>
      <div className="adm">
        <Login />
      </div>
    </AuthContext.Provider>
  );
  return { ui, reload };
};

// the email forms are folded behind this button until it is pressed
const openEmail = () => userEvent.click(screen.getByRole("button", { name: "Sign in with Email" }));

beforeEach(() => {
  mockApi.mockReset();
  global.__search = "";
});

test("the door is Vinay's Private Room, not for public use, with one button for Google and one for Email; the email forms stay folded until the second is pressed", async () => {
  render(door().ui);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Vinay’s Private Room(not for public use)");
  expect(screen.getByText("Sign in with Google").closest("a").getAttribute("href")).toBe("/api/auth/google/start");
  const toggle = screen.getByRole("button", { name: "Sign in with Email" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  // nothing about email sign-in is shown yet
  expect(screen.queryByLabelText("Email address")).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.queryByRole("tab", { name: "Create account" })).toBeNull();
  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByLabelText("Email address")).toBeTruthy();
  expect(screen.getByLabelText("Password")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Create account" })).toBeTruthy();
  expect(screen.getByText(/however they arrive/)).toBeTruthy();
  // pressing it again folds it away
  await userEvent.click(toggle);
  expect(screen.queryByLabelText("Email address")).toBeNull();
});

test("a way that is turned off is not shown", async () => {
  render(door({ methods: { google: false, password: true, code: false } }).ui);
  expect(screen.queryByText("Sign in with Google")).toBeNull();
  await openEmail();
  expect(screen.queryByText(/Email me a sign-in code/)).toBeNull();
  expect(screen.getByLabelText("Email address")).toBeTruthy();
});

test("without a mail server there is no link or code to ask for, but the password still works", async () => {
  render(door({ methods: { google: true, password: true, code: false }, emailReady: false }).ui);
  await openEmail();
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.getByLabelText("Password")).toBeTruthy();
});

test("signing in with a password sends the address and password, then reloads the session", async () => {
  mockApi.mockResolvedValue({ ok: true });
  const { ui, reload } = door();
  render(ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), " Me@Example.com ");
  await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-9-Battery");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockApi).toHaveBeenCalledWith("/api/auth/email/login", { method: "POST", body: { email: "Me@Example.com", password: "Correct-Horse-9-Battery", remember: true } });
  await act(async () => Promise.resolve());
  expect(reload).toHaveBeenCalled();
});

test("a refused sign-in shows the server's words and does not reload", async () => {
  mockApi.mockRejectedValue(new Error("That email address or password is not right."));
  const { ui, reload } = door();
  render(ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "wrong-password-1");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/not right/);
  expect(reload).not.toHaveBeenCalled();
});

test("the password can be shown and hidden", async () => {
  render(door().ui);
  await openEmail();
  const field = screen.getByLabelText("Password");
  expect(field.getAttribute("type")).toBe("password");
  await userEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(field.getAttribute("type")).toBe("text");
  await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(field.getAttribute("type")).toBe("password");
});

test("an emailed code: ask for it, then type it", async () => {
  mockApi.mockResolvedValueOnce({ ok: true, message: "If that address can sign in here, a 6-digit code is on its way." });
  const { ui, reload } = door();
  render(ui);
  await openEmail();
  await userEvent.click(screen.getByText("Email me a sign-in code instead"));
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  expect(mockApi).toHaveBeenCalledWith("/api/auth/email/code", { method: "POST", body: { email: "me@example.com" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/code is on its way/);

  mockApi.mockResolvedValueOnce({ ok: true });
  await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/code/verify", { method: "POST", body: { email: "me@example.com", code: "123456", remember: true } });
  await act(async () => Promise.resolve());
  expect(reload).toHaveBeenCalled();
});

test("a forgotten or first password: the link is asked for by address, and the answer does not reveal who exists", async () => {
  mockApi.mockResolvedValue({ ok: true, message: "If that address can sign in here, a link is on its way. It works for an hour." });
  render(door().ui);
  await openEmail();
  await userEvent.click(screen.getByText("Forgot your password, or first time here?"));
  await userEvent.type(screen.getByLabelText("Email address"), "someone@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Email me the link" }));
  expect(mockApi).toHaveBeenCalledWith("/api/auth/email/link", { method: "POST", body: { email: "someone@example.com" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/If that address can sign in here/);
  expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy();
});

test("an error from Google's round trip is explained on the door", () => {
  global.__search = "error=google-off";
  render(door().ui);
  expect(screen.getByRole("alert").textContent).toMatch(/Google is turned off/);
});

/* ---------------------------------------------------------------- the emailed link's page */

const reset = () => (
  <div className="adm">
    <ResetPassword />
  </div>
);

test("the password rules tick off as they are met", () => {
  expect(passwordRules("short").map((r) => r.ok)).toEqual([false, false]);
  expect(passwordRules("Abcdefg1!x").map((r) => r.ok)).toEqual([true, true]);
  expect(passwordRules("a long passphrase of words").map((r) => r.ok)).toEqual([true, true]);
  expect(passwordRules("alllowercase").map((r) => r.ok)).toEqual([true, false]);
});

test("a used or expired link is said plainly, with the way to get a new one", async () => {
  global.__search = "token=abc";
  mockApi.mockRejectedValue(Object.assign(new Error("This link has expired or has already been used. Ask for a new one."), { code: "expired" }));
  render(reset());
  expect((await screen.findByRole("alert")).textContent).toMatch(/expired or has already been used/);
  expect(screen.getByText("Back to sign in")).toBeTruthy();
});

test("a good link shows whose it is in part, checks the two entries match, and saves", async () => {
  global.__search = "token=abc";
  mockApi.mockResolvedValueOnce({ ok: true, email: "m••••@example.com", hasPassword: false, name: "Mo Trader" });
  render(reset());
  expect(await screen.findByText("Complete your setup")).toBeTruthy();
  expect(screen.getByText("m••••@example.com")).toBeTruthy();

  await userEvent.type(screen.getByLabelText("New password"), "Correct-Horse-9-Battery");
  await userEvent.type(screen.getByLabelText("Type it again"), "Something-Else-9-Entirely");
  await userEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  expect(screen.getByRole("alert").textContent).toMatch(/not the same/);
  expect(mockApi).toHaveBeenCalledTimes(1);

  mockApi.mockResolvedValueOnce({ ok: true });
  await userEvent.clear(screen.getByLabelText("Type it again"));
  await userEvent.type(screen.getByLabelText("Type it again"), "Correct-Horse-9-Battery");
  await userEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  expect(screen.getByLabelText("Your name").value).toBe("Mo Trader");
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/password", { method: "POST", body: { token: "abc", password: "Correct-Horse-9-Battery", name: "Mo Trader" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/setup is complete/);
});

/* ---------------------------------------------------------------- sign in / create account */

test("after a wrong password the way out is offered right beside the message", async () => {
  mockApi.mockRejectedValue(Object.assign(new Error("That email address or password is not right."), { code: "bad_login" }));
  render(door().ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "wrong-password-1");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not right/);
  expect(alert.textContent).toMatch(/Forgot your password\?/);
  expect(alert.textContent).toMatch(/New here\? Create an account/);
  // the link goes to the reset form with nothing typed lost
  mockApi.mockReset();
  await userEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  expect(screen.getByRole("button", { name: "Email me the link" })).toBeTruthy();
});

test("a different kind of error does not offer the reset link", async () => {
  mockApi.mockRejectedValue(Object.assign(new Error("Enter your email address and password."), { code: "invalid" }));
  render(door().ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).not.toMatch(/Forgot your password\?/);
});

test("Create account asks for a name and an address, sends the request, and says what happens next", async () => {
  mockApi.mockResolvedValue({ ok: true, message: "Thank you. If this address already has access, a link is on its way. Otherwise your request has gone to the owner." });
  render(door().ui);
  await openEmail();
  await userEvent.click(screen.getByRole("tab", { name: "Create account" }));
  expect(screen.queryByText("Sign in with Google")).toBeNull();
  await userEvent.type(screen.getByLabelText("Your name"), "New Trader");
  await userEvent.type(screen.getByLabelText("Email address"), "new@example.com");
  await userEvent.type(screen.getByLabelText(/Why do you need access/), "I follow the NIFTY");
  await userEvent.click(screen.getByRole("button", { name: "Request access" }));
  expect(mockApi).toHaveBeenCalledWith("/api/auth/email/signup", { method: "POST", body: { name: "New Trader", email: "new@example.com", note: "I follow the NIFTY" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/gone to the owner/);
  await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

test("Create account is not offered when no mail server is set up", async () => {
  render(door({ emailReady: false }).ui);
  await openEmail();
  expect(screen.queryByRole("tab", { name: "Create account" })).toBeNull();
});
