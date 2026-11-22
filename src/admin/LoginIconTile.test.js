import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginIconTile from "./LoginIconTile";

const mockApi = jest.fn();
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
beforeEach(() => {
  mockApi.mockReset();
  window.localStorage.setItem("vpt.loginIcon", "off");
});

test("the switch shows the icon's state, turns it off and on, and says /me always opens", async () => {
  mockApi.mockResolvedValueOnce({ on: true });
  render(<LoginIconTile />);
  const sw = await screen.findByRole("switch", { name: /login icon/i });
  await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
  expect(screen.getByText(/Shown in the public website's top bar/)).toBeTruthy();
  expect(screen.getByText(/\/me always opens/)).toBeTruthy();

  mockApi.mockResolvedValueOnce({ on: false });
  await userEvent.click(sw);
  expect(mockApi).toHaveBeenLastCalledWith("/api/admin/settings/login-icon", { method: "PUT", body: { on: false } });
  await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
  expect(screen.getByText(/Hidden from the public website/)).toBeTruthy();
  expect(window.localStorage.getItem("vpt.loginIcon")).toBeNull(); // the browser's memory is dropped; the next visit asks the server

  await waitFor(() => expect(sw.disabled).toBe(false));
  mockApi.mockResolvedValueOnce({ on: true });
  await userEvent.click(sw);
  await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
});

test("if the server refuses the change the switch goes back and says so", async () => {
  mockApi.mockResolvedValueOnce({ on: true });
  render(<LoginIconTile />);
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
  mockApi.mockRejectedValueOnce(new Error("Only the superadmin can do this."));
  await userEvent.click(sw);
  expect((await screen.findByRole("alert")).textContent).toMatch(/Only the superadmin/);
  expect(sw.getAttribute("aria-checked")).toBe("true");
});
