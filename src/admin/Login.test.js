import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

// the first step of signing in by email: the address is checked against the owner's list, and only then do the password and the
// reset / code options appear
const checked = (over = {}) => ({ ok: true, email: "me@example.com", hasPassword: true, can: { password: true, code: true, link: true }, ...over });
async function enter(address = "me@example.com", info = {}) {
  mockApi.mockResolvedValueOnce(checked({ email: address.trim(), ...info }));
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), address);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(address.trim());
}

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
  expect(screen.queryByLabelText("Email address")).toBeNull();
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.queryByRole("tab", { name: "Create account" })).toBeNull();
  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  // first only the address; the password and the options wait until the server says the address is on the list
  expect(screen.getByLabelText("Email address")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.queryByText(/sign-in code instead/)).toBeNull();
  expect(screen.getByRole("tab", { name: "Create account" })).toBeTruthy();
  expect(screen.getByText(/^Authorised accounts only\.$/)).toBeTruthy();
  await userEvent.click(toggle);
  expect(screen.queryByLabelText("Email address")).toBeNull();
});

test("an address that is not on the list gets the red refusal and nothing else: no password field, no reset, no code", async () => {
  mockApi.mockRejectedValueOnce(Object.assign(new Error("You are not authorized to enter this space. Please do not try to sign in: this is the personal space of Vinay Kumar Tiwari, open only to the people he has allowed."), { code: "not_authorized" }));
  render(door().ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), "stranger@elsewhere.org");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  const warn = await screen.findByRole("alert");
  expect(warn.className).toMatch(/gate__denied/);
  expect(warn.textContent).toMatch(/Access denied/);
  expect(warn.textContent).toMatch(/not authorized to enter this space.*personal space of Vinay Kumar Tiwari/);
  expect(mockApi).toHaveBeenCalledWith("/api/auth/email/check", { method: "POST", body: { email: "stranger@elsewhere.org" } });
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.queryByText(/sign-in code/)).toBeNull();
  expect(screen.queryByText(/Email me/)).toBeNull();
  expect(screen.queryByText(/wrong|not right/)).toBeNull();
  // the address field is still there to start again
  expect(screen.getByLabelText("Email address")).toBeTruthy();
});

test("a shut-out visitor sees how long the pause runs for unlisted addresses, the button stays usable for a listed one, and the pause ends by itself", async () => {
  jest.useFakeTimers();
  try {
    mockApi.mockRejectedValueOnce(Object.assign(new Error("You are not authorized to enter this space. Too many attempts: this device is paused for 1 minute."), { code: "not_authorized", data: { blocked: true, retryAfter: 65 } }));
    render(door().ui);
    await act(async () => {
      screen.getByRole("button", { name: "Sign in with Email" }).click();
    });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "stranger@elsewhere.org" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect((await screen.findByRole("timer")).textContent).toMatch(/not on the list are paused for 1:05.*allowed is never held up/);
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/0:55/);
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).disabled).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("while a visitor is paused, a listed address still goes straight through and the pause clears", async () => {
  mockApi.mockRejectedValueOnce(Object.assign(new Error("You are not authorized to enter this space."), { code: "not_authorized", data: { blocked: true, retryAfter: 1800 } }));
  render(door().ui);
  await openEmail();
  await userEvent.type(screen.getByLabelText("Email address"), "stranger@elsewhere.org");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("timer")).toBeTruthy();
  mockApi.mockResolvedValueOnce(checked({ email: "owner@example.com" }));
  await userEvent.clear(screen.getByLabelText("Email address"));
  await userEvent.type(screen.getByLabelText("Email address"), "owner@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByLabelText("Password")).toBeTruthy();
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the warning names email addresses, and the password field warns when Caps Lock is on", async () => {
  global.__search = "error=unauthorized";
  const { ui } = door();
  const { unmount } = render(ui);
  expect(screen.getByRole("alert").textContent).toMatch(/open only to the email addresses he has allowed/);
  unmount();
  global.__search = "";
  render(door().ui);
  await enter();
  const field = screen.getByLabelText("Password");
  field.focus();
  expect(document.activeElement).toBe(field);
  const ev = new KeyboardEvent("keyup", { key: "A", bubbles: true });
  ev.getModifierState = (k) => k === "CapsLock";
  await act(async () => {
    field.dispatchEvent(ev);
  });
  expect(screen.getByText("Caps Lock is on")).toBeTruthy();
});

test("a Google account that is not on the list gets the same refusal", () => {
  global.__search = "error=unauthorized";
  render(door().ui);
  expect(screen.getByRole("alert").textContent).toMatch(/Access denied.*not authorized to enter this space/);
});

test("a way that is turned off is not shown", async () => {
  render(door({ methods: { google: false, password: true, code: false } }).ui);
  expect(screen.queryByText("Sign in with Google")).toBeNull();
  await enter();
  expect(screen.queryByText(/Email me a sign-in code/)).toBeNull();
  expect(screen.getByLabelText("Password")).toBeTruthy();
});

test("without a mail server there is no link or code to ask for, but the password still works", async () => {
  render(door({ methods: { google: true, password: true, code: false }, emailReady: false }).ui);
  await enter("me@example.com", { can: { password: true, code: false, link: false } });
  expect(screen.queryByText(/Forgot your password/)).toBeNull();
  expect(screen.getByLabelText("Password")).toBeTruthy();
});

test("signing in with a password sends the address and password, then reloads the session", async () => {
  const { ui, reload } = door();
  render(ui);
  await enter(" Me@Example.com ".trim());
  mockApi.mockResolvedValueOnce({ ok: true });
  await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-9-Battery");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/login", { method: "POST", body: { email: "Me@Example.com", password: "Correct-Horse-9-Battery", remember: true } });
  await act(async () => Promise.resolve());
  expect(reload).toHaveBeenCalled();
});

test("a refused sign-in shows the server's words and does not reload", async () => {
  const { ui, reload } = door();
  render(ui);
  await enter();
  mockApi.mockRejectedValueOnce(new Error("That email address or password is not right."));
  await userEvent.type(screen.getByLabelText("Password"), "wrong-password-1");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/not right/);
  expect(reload).not.toHaveBeenCalled();
});

test("the password can be shown and hidden", async () => {
  render(door().ui);
  await enter();
  const field = screen.getByLabelText("Password");
  expect(field.getAttribute("type")).toBe("password");
  await userEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(field.getAttribute("type")).toBe("text");
  await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(field.getAttribute("type")).toBe("password");
});

test("an emailed code: ask for it, then type it", async () => {
  const { ui, reload } = door();
  render(ui);
  await enter();
  mockApi.mockResolvedValueOnce({ ok: true, message: "A 6-digit code is on its way to your inbox. It works for 10 minutes." });
  await userEvent.click(screen.getByText("Email me a sign-in code instead"));
  await userEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/code", { method: "POST", body: { email: "me@example.com" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/code is on its way/);

  mockApi.mockResolvedValueOnce({ ok: true });
  await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/code/verify", { method: "POST", body: { email: "me@example.com", code: "123456", remember: true } });
  await act(async () => Promise.resolve());
  expect(reload).toHaveBeenCalled();
});

test("a forgotten or first password: the link goes to the address already checked", async () => {
  render(door().ui);
  await enter("someone@example.com");
  mockApi.mockResolvedValueOnce({ ok: true, message: "A link to choose a new password is on its way to your inbox. It works for an hour." });
  await userEvent.click(screen.getByText("Forgot your password, or first time here?"));
  await userEvent.click(screen.getByRole("button", { name: "Email me the link" }));
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/link", { method: "POST", body: { email: "someone@example.com" } });
  expect((await screen.findByRole("status")).textContent).toMatch(/link to choose a new password is on its way/);
  expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy();
});

test("a person with no password yet goes straight to the way of choosing one", async () => {
  render(door().ui);
  await enter("new@example.com", { hasPassword: false });
  expect(screen.getByRole("button", { name: "Email me the link" })).toBeTruthy();
  expect(screen.queryByLabelText("Password")).toBeNull();
});

test("'Change' goes back to asking for the address", async () => {
  render(door().ui);
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(screen.getByLabelText("Email address")).toBeTruthy();
  expect(screen.queryByLabelText("Password")).toBeNull();
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

test("after a wrong password the way out is offered right beside the message — only for a listed address", async () => {
  render(door().ui);
  await enter();
  mockApi.mockRejectedValueOnce(Object.assign(new Error("That email address or password is not right."), { code: "bad_login" }));
  await userEvent.type(screen.getByLabelText("Password"), "wrong-password-1");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not right/);
  expect(alert.textContent).toMatch(/Forgot your password\?/);
  expect(alert.textContent).toMatch(/New here\? Create an account/);
  await userEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  expect(screen.getByRole("button", { name: "Email me the link" })).toBeTruthy();
});

test("a different kind of error does not offer the reset link", async () => {
  render(door().ui);
  await enter();
  mockApi.mockRejectedValueOnce(Object.assign(new Error("Enter your email address and password."), { code: "invalid" }));
  await userEvent.type(screen.getByLabelText("Password"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).not.toMatch(/Forgot your password\?/);
});

test("if the owner removes a person between the check and the sign-in, the sign-in ends in the refusal", async () => {
  render(door().ui);
  await enter();
  mockApi.mockRejectedValueOnce(Object.assign(new Error("You are not authorized to enter this space."), { code: "not_authorized" }));
  await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-9-Battery");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).className).toMatch(/gate__denied/);
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.getByLabelText("Email address")).toBeTruthy();
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
  expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
});

test("Create account is not offered when no mail server is set up", async () => {
  render(door({ emailReady: false }).ui);
  await openEmail();
  expect(screen.queryByRole("tab", { name: "Create account" })).toBeNull();
});

test("the Kite-style door keeps DrishtiAI's own mark, says it is not Zerodha, and gives every field a floating label", async () => {
  const { container } = render(door().ui);
  expect(container.querySelector(".gate__badge img").getAttribute("src")).toBe("/drishti-logo.svg");
  expect(container.querySelector(".gate__brand span").textContent).toBe("Privately owned by Vinay Kumar Tiwari. For personal use only.");
  expect(container.querySelector(".gate__notice p").textContent.replace(/ /g, " ")).toBe("Namaste, and thank you for visiting. This is a personal workspace of Vinay Kumar Tiwari, not a public service. If you have reached it by chance, please do not try to enter — you are most welcome on the public website instead.");
  expect(container.innerHTML).not.toMatch(/zerodha[^"]*\.(svg|png)|kite[^"]*\.(svg|png)/i); // none of Zerodha's artwork
  // the small print and the way out sit under the card
  expect(container.querySelector(".gate__below .gate__fine").textContent).toMatch(/^Authorised accounts only\.$/);
  expect(container.querySelector(".gate__below .gate__home").getAttribute("href")).toBe("/");
  await openEmail();
  const email = screen.getByLabelText("Email address");
  expect(email.getAttribute("placeholder")).toBe(" "); // what lets the label rest inside and float up
});
