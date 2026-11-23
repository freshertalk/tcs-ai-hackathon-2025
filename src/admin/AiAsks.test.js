import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AiAsks from "./AiAsks";
import { api } from "./api";

jest.mock("./api", () => ({ api: jest.fn() }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
afterEach(() => api.mockReset());

const ask = { key: "picks-review", feature: "Research Top 10 — the AI's review", why: "The Top 10 changed enough to need a fresh AI review.", first: "2026-11-23T04:00:00.000Z", last: "2026-11-23T04:10:00.000Z", n: 3 };

test("an automatic wish for the AI shows as a popup: what and why; Allow once starts it, Not now dismisses it", async () => {
  api.mockResolvedValueOnce({ asks: [ask, { ...ask, key: "scanner-review", feature: "Live scanner — the AI's review", why: "", n: 1 }] });
  render(<AiAsks />);
  expect(await screen.findByText("DrishtiAI would like to use the AI (2)")).toBeTruthy();
  expect(screen.getByRole("dialog").textContent).toMatch(/AI credit is used only if you allow it/);
  expect(screen.getByText("Research Top 10 — the AI's review")).toBeTruthy();
  expect(screen.getByText("The Top 10 changed enough to need a fresh AI review.")).toBeTruthy();
  expect(screen.getByText(/asked 3 times since/)).toBeTruthy();
  api.mockResolvedValueOnce({ started: true, asks: [{ ...ask, key: "scanner-review", feature: "Live scanner — the AI's review", why: "", n: 1 }] });
  fireEvent.click(screen.getAllByRole("button", { name: "Allow once" })[0]);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/ai/asks/picks-review/allow", { method: "POST" }));
  expect(await screen.findByText(/Started — the AI is working on it now/)).toBeTruthy();
  expect(screen.queryByText("Research Top 10 — the AI's review")).toBeNull();
  api.mockResolvedValueOnce({ ok: true, asks: [] });
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/ai/asks/scanner-review/dismiss", { method: "POST" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // nothing left to ask: the popup goes
});

test("after Allow on the last ask, a short note says it started, and Close removes it", async () => {
  api.mockResolvedValueOnce({ asks: [ask] });
  render(<AiAsks />);
  const allow = await screen.findByRole("button", { name: "Allow once" });
  api.mockResolvedValueOnce({ started: true, asks: [] });
  fireEvent.click(allow);
  expect(await screen.findByText(/Started — the AI is working on it now/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

test("no asks: nothing is shown", async () => {
  api.mockResolvedValueOnce({ asks: [] });
  const { container } = render(<AiAsks />);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/ai/asks"));
  expect(container.innerHTML).toBe("");
});
