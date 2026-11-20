import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminUsers from "./AdminUsers";

const mockApi = jest.fn();
const mockAsk = jest.fn();
let mockUser = { role: "superadmin", owner: true, email: "owner@example.com" };
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("./live", () => ({ useTopics: () => {} }));
jest.mock("./auth", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("./dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));
jest.mock("./Shell", () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));

const person = (email, role, over = {}) => ({ email, role, owner: false, locked: false, lastLogin: null, hasPassword: false, googleLinked: true, lockedOut: false, ...over });
const list = (over = {}) => ({
  canManageSupers: true,
  emailReady: false,
  admins: [person("owner@example.com", "superadmin", { owner: true, locked: true }), person("partner@example.com", "superadmin", { addedBy: "owner@example.com", madeSuperAt: "2026-11-20T10:00:00.000Z" }), person("helper@example.com", "admin", { addedBy: "owner@example.com" })],
  ...over,
});
const serve = (first, more = {}) =>
  mockApi.mockImplementation((url, opts) => {
    if (url === "/api/admin/requests") return Promise.resolve({ requests: [] });
    const key = `${(opts && opts.method) || "GET"} ${url}`;
    if (more[key]) return typeof more[key] === "function" ? more[key](opts) : Promise.resolve(more[key]);
    return Promise.resolve(first);
  });
const rows = () => [...document.querySelectorAll(".adm-people li")];
const rowOf = (email) => rows().find((li) => li.querySelector("b").textContent === email);
const called = (method, url) => mockApi.mock.calls.find((c) => c[0] === url && ((c[1] && c[1].method) || "GET") === method);

beforeEach(() => {
  mockApi.mockReset();
  mockAsk.mockReset();
  mockUser = { role: "superadmin", owner: true, email: "owner@example.com" };
});

test("the owner sees who is the owner, who is a superadmin and who is an admin, and can change an admin into a superadmin and back", async () => {
  serve(list());
  render(<AdminUsers />);
  await waitFor(() => expect(screen.getByText("helper@example.com")).toBeTruthy());
  expect(rows().map((li) => li.querySelector(".adm-role").textContent)).toEqual(["Owner · superadmin", "Superadmin", "Admin"]);
  expect(screen.getByText(/Only you, the owner, can make someone a superadmin or take that away\./)).toBeTruthy();
  // the owner's own row: never removed, never changed
  expect(rowOf("owner@example.com").textContent).toMatch(/Cannot be removed/);
  expect(rowOf("owner@example.com").textContent).not.toMatch(/Make admin|Make superadmin/);
  expect(rowOf("partner@example.com").textContent).toMatch(/superadmin since/);

  // an admin is made a superadmin only after the owner has read what that hands over
  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(rowOf("helper@example.com").querySelector("button:nth-last-of-type(2)"));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  const asked = mockAsk.mock.calls[0][0];
  expect(asked.title).toBe("Make this person a superadmin?");
  expect(asked.tone).toBe("danger");
  const body = render(asked.body);
  expect(body.container.textContent).toMatch(/helper@example\.com will be able to do everything you can.*trade on the site’s own Zerodha account.*your Kundali among them.*Only you can make someone a superadmin/);
  body.unmount();
  expect(called("PUT", "/api/admin/admins/helper%40example.com")).toBeUndefined();

  // "Make superadmin", confirmed
  const after = list();
  after.admins[2] = person("helper@example.com", "superadmin", { addedBy: "owner@example.com" });
  serve(list(), { "PUT /api/admin/admins/helper%40example.com": after });
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByText("Make superadmin"));
  await waitFor(() => expect(screen.getByText("helper@example.com is now a superadmin.")).toBeTruthy());
  expect(called("PUT", "/api/admin/admins/helper%40example.com")[1].body).toEqual({ role: "superadmin" });
  expect(rowOf("helper@example.com").querySelector(".adm-role").textContent).toBe("Superadmin");

  // and back: asked in plain words too
  const back = list();
  back.admins[1] = person("partner@example.com", "admin", { addedBy: "owner@example.com" });
  serve(after, { "PUT /api/admin/admins/partner%40example.com": back });
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(rowOf("partner@example.com").querySelector("button:nth-last-of-type(2)"));
  await waitFor(() => expect(screen.getByText("partner@example.com is an admin again.")).toBeTruthy());
  expect(mockAsk.mock.calls[2][0].title).toBe("Make this person an admin again?");
  expect(called("PUT", "/api/admin/admins/partner%40example.com")[1].body).toEqual({ role: "admin" });
});

test("the owner can add a person as a superadmin in one step, after confirming; an admin is added without the question", async () => {
  const added = list();
  added.admins.splice(2, 0, person("new@example.com", "superadmin"));
  serve(list(), { "POST /api/admin/admins": { ...added, invited: false, inviteProblem: "" } });
  render(<AdminUsers />);
  await waitFor(() => expect(screen.getByText("Add them as")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Add admin" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Add a person"), { target: { value: "new@example.com" } });
  fireEvent.click(screen.getByRole("radio", { name: /Superadmin/ }));
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Add superadmin" }));
  await waitFor(() => expect(screen.getByText(/Added as a superadmin\. They can now sign in/)).toBeTruthy());
  expect(mockAsk.mock.calls[0][0].title).toBe("Add this person as a superadmin?");
  expect(called("POST", "/api/admin/admins")[1].body).toEqual({ email: "new@example.com", invite: true, role: "superadmin" });
  // the choice goes back to "Admin" afterwards, so the next person is not made a superadmin by accident
  expect(screen.getByRole("radio", { name: /^Admin/ }).checked).toBe(true);

  mockApi.mockClear();
  mockAsk.mockClear();
  serve(list(), { "POST /api/admin/admins": { ...list(), invited: false, inviteProblem: "" } });
  fireEvent.change(screen.getByLabelText("Add a person"), { target: { value: "plain@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Add admin" }));
  await waitFor(() => expect(called("POST", "/api/admin/admins")).toBeTruthy());
  expect(mockAsk).not.toHaveBeenCalled();
  expect(called("POST", "/api/admin/admins")[1].body).toEqual({ email: "plain@example.com", invite: true });
});

test("a superadmin the owner made manages the admins, but is not offered the superadmin choices or another superadmin’s buttons", async () => {
  mockUser = { role: "superadmin", owner: false, email: "partner@example.com" };
  serve(list({ canManageSupers: false }));
  render(<AdminUsers />);
  await waitFor(() => expect(screen.getByText("helper@example.com")).toBeTruthy());
  expect(screen.getByText(/Only the owner can make someone a superadmin or take that away; you manage the admins\./)).toBeTruthy();
  expect(screen.queryByText("Add them as")).toBeNull();
  expect(screen.getByLabelText("Add an admin")).toBeTruthy();
  expect(screen.queryByText("Make superadmin")).toBeNull();
  expect(screen.queryByText("Make admin")).toBeNull();
  // the owner's row is the owner's
  expect(rowOf("owner@example.com").textContent).toMatch(/Managed by the owner/);
  expect(rowOf("owner@example.com").querySelector("button")).toBeNull();
  // their own row: their own sign-in, but not their own removal
  expect(rowOf("partner@example.com").textContent).toMatch(/Sign out everywhere.*Removed by the owner only/);
  // an admin: everything, as before
  expect([...rowOf("helper@example.com").querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Sign out everywhere", "Remove"]);
});
