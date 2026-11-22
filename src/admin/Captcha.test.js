import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import crypto from "crypto";
import { AuthContext } from "./auth";
import Login from "./Login";
import { solvePow, zeroBits } from "./Captcha";

// the test browser (jsdom) has no TextEncoder; real browsers do
global.TextEncoder = global.TextEncoder || require("util").TextEncoder;

const mockApi = jest.fn();
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children), useSearchParams: () => [new URLSearchParams("")] };
});

// what a browser's crypto.subtle.digest does, from node's
const digest = (buf) => Promise.resolve(Uint8Array.from(crypto.createHash("sha256").update(Buffer.from(buf)).digest()).buffer);
beforeEach(() => {
  mockApi.mockReset();
  // the page hashes with the browser's own crypto
  Object.defineProperty(window, "crypto", { configurable: true, value: { subtle: { digest: (_alg, buf) => digest(buf) }, getRandomValues: (a) => a } });
});

test("the proof of work finds a number whose hash begins with the asked zero bits, and can be stopped", async () => {
  const pow = { salt: "abc123", bits: 12 };
  const nonce = await solvePow(pow, { digest });
  const out = new Uint8Array(await digest(new TextEncoder().encode(`${pow.salt}:${nonce}`)));
  expect(zeroBits(out)).toBeGreaterThanOrEqual(12);
  expect(zeroBits(new Uint8Array([0, 0, 0b00010000]))).toBe(19);
  expect(await solvePow({ salt: "x", bits: 40 }, { digest, isCancelled: () => true })).toBeNull();
});

const door = () => (
  <AuthContext.Provider value={{ loading: false, user: null, methods: { google: true, password: true, code: true }, emailReady: true, captcha: true, reload: jest.fn() }}>
    <div className="adm">
      <Login />
    </div>
  </AuthContext.Provider>
);
const challenge = (over = {}) => ({ token: "tok1", image: "data:image/svg+xml;base64,AAAA", kind: "text", pow: { salt: "s1", bits: 8 }, expiresIn: 300, ...over });

test("the email door shows a picture, does the work by itself, and sends the pass with every step", async () => {
  mockApi.mockImplementation(async (url, opts = {}) => {
    if (url === "/api/auth/captcha") return challenge();
    if (url === "/api/auth/gate") return { ok: true, gate: "PASS1", expiresIn: 900 };
    if (url === "/api/auth/email/check") return { ok: true, email: "me@example.com", hasPassword: true, can: { password: true, code: true, link: true } };
    return { ok: true };
  });
  render(door());
  // nothing is fetched until the email section is opened
  expect(mockApi).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Sign in with Email" }));
  expect((await screen.findByAltText("Characters to type")).getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(await screen.findByText(/Ready — a human check/)).toBeTruthy();

  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Type the characters shown"), "k7qmr");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Password");
  const gateCall = mockApi.mock.calls.find((c) => c[0] === "/api/auth/gate");
  expect(gateCall[1].body.token).toBe("tok1");
  expect(gateCall[1].body.answer).toBe("k7qmr");
  expect(gateCall[1].body.nonce).toMatch(/^\d+$/);
  expect(mockApi.mock.calls.find((c) => c[0] === "/api/auth/email/check")[1].body).toEqual({ email: "me@example.com", gate: "PASS1" });

  // the pass is kept: the next step does not ask for the picture again, and carries it
  await userEvent.type(screen.getByLabelText("Password"), "Correct-Horse-9-Battery");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockApi.mock.calls.filter((c) => c[0] === "/api/auth/gate")).toHaveLength(1);
  expect(mockApi).toHaveBeenLastCalledWith("/api/auth/email/login", { method: "POST", body: { email: "me@example.com", password: "Correct-Horse-9-Battery", remember: true, gate: "PASS1" } });
});

test("a wrong answer shows the server's words and the new picture it sent; nothing is asked of the server before an answer is typed", async () => {
  mockApi.mockImplementation(async (url) => {
    if (url === "/api/auth/captcha") return challenge();
    if (url === "/api/auth/gate") throw Object.assign(new Error("That is not what the picture shows. Here is a new one — please try again."), { code: "captcha_wrong", data: { challenge: challenge({ token: "tok2", image: "data:image/svg+xml;base64,BBBB" }) } });
    return { ok: true };
  });
  render(door());
  await userEvent.click(screen.getByRole("button", { name: "Sign in with Email" }));
  await screen.findByText(/Ready — a human check/);
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  // no answer typed: refused on the page, with no call to the server
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/Type the characters shown in the picture first/);
  expect(mockApi.mock.calls.some((c) => c[0] === "/api/auth/gate")).toBe(false);
  await userEvent.type(screen.getByLabelText("Type the characters shown"), "WRONG");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/not what the picture shows/);
  expect(screen.getByAltText("Characters to type").getAttribute("src")).toMatch(/BBBB/);
  expect(screen.getByLabelText("Type the characters shown").value).toBe("");
  expect(mockApi.mock.calls.some((c) => c[0] === "/api/auth/email/check")).toBe(false);
});

test("a sum is shown as a sum; when the pass runs out the door goes back to the picture", async () => {
  let n = 0;
  mockApi.mockImplementation(async (url) => {
    if (url === "/api/auth/captcha") return challenge({ kind: "sum", token: `t${(n += 1)}` });
    if (url === "/api/auth/gate") return { ok: true, gate: "PASS1", expiresIn: 900 };
    if (url === "/api/auth/email/check") return { ok: true, email: "me@example.com", hasPassword: true, can: { password: true, code: true, link: true } };
    if (url === "/api/auth/email/login") throw Object.assign(new Error("Please complete the security check first."), { code: "gate_required" });
    return { ok: true };
  });
  render(door());
  await userEvent.click(screen.getByRole("button", { name: "Sign in with Email" }));
  expect(await screen.findByLabelText("Solve the sum shown")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Email address"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Solve the sum shown"), "11");
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.type(await screen.findByLabelText("Password"), "x-Correct-Horse-9");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/complete the security check again/);
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(await screen.findByLabelText("Solve the sum shown")).toBeTruthy();
});

test("with the check switched off on the server the door shows no picture and sends no pass", async () => {
  mockApi.mockResolvedValue({ ok: true });
  render(
    <AuthContext.Provider value={{ loading: false, user: null, methods: { google: true, password: true, code: true }, emailReady: true, reload: jest.fn() }}>
      <div className="adm">
        <Login />
      </div>
    </AuthContext.Provider>
  );
  await userEvent.click(screen.getByRole("button", { name: "Sign in with Email" }));
  expect(screen.queryByRole("group", { name: "Security check" })).toBeNull();
  expect(mockApi).not.toHaveBeenCalled();
});
