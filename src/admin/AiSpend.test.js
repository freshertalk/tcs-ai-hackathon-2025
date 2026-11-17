import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "./auth";
import AiSpend from "./AiSpend";

const mockApi = jest.fn();
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));

const data = (over = {}) => ({
  enforced: true,
  auto: false,
  by: "",
  at: null,
  blockedToday: 7,
  blocked: [{ what: "Social & news digest", n: 5, first: "2026-11-17T04:00:00.000Z", last: "2026-11-17T09:00:00.000Z" }, { what: "WhatsApp updates", n: 2, first: "2026-11-17T05:00:00.000Z", last: "2026-11-17T08:00:00.000Z" }],
  today: { date: "2026-11-17", features: [{ id: "tradeai", name: "TradeAI chat", calls: 3, input: 12400, output: 2100 }, { id: "social", name: "Social & news digest", calls: 0, input: 0, output: 0 }] },
  saved: { calls: 2 },
  ...over,
});
const page = (role = "superadmin") => (
  <AuthContext.Provider value={{ user: { role } }}>
    <AiSpend />
  </AuthContext.Provider>
);
const settle = () => act(async () => Promise.resolve());
beforeEach(() => mockApi.mockReset());

test("it says the AI is asked only on a button, what was held back and what was used", async () => {
  mockApi.mockResolvedValue(data());
  render(page());
  await settle();
  expect(screen.getByText("AI credit protection")).toBeTruthy();
  expect(document.querySelector(".ais-spend").textContent).toMatch(/On\. The AI company is asked only when you press an AI button/);
  expect(document.querySelector(".ais-spend").textContent).toMatch(/Held back today: 7 automatic attempts that would have used credit/);
  expect(screen.getByText(/Social & news digest — 5×/)).toBeTruthy();
  expect(document.querySelector(".ais-spend").textContent).toMatch(/TradeAI chat 3× \(12\.4k in, 2\.1k out\)/);
  expect(document.querySelector(".ais-spend").textContent).not.toMatch(/Social & news digest 0×/);
  expect(document.querySelector(".ais-spend").textContent).toMatch(/2 repeat questions answered from memory, free/);
});

test("with nothing tried and nothing used it says so plainly", async () => {
  mockApi.mockResolvedValue(data({ blockedToday: 0, blocked: [], today: { features: [] }, saved: null }));
  render(page());
  await settle();
  expect(document.querySelector(".ais-spend").textContent).toMatch(/nothing has tried to run on its own/);
  expect(document.querySelector(".ais-spend").textContent).toMatch(/nothing — no AI call has been made/);
});

test("only the owner sees the switch, it is off by default, and turning it on is a deliberate act", async () => {
  mockApi.mockResolvedValue(data());
  const { unmount } = render(page("admin"));
  await settle();
  expect(screen.queryByRole("checkbox")).toBeNull();
  unmount();

  mockApi.mockResolvedValue(data());
  render(page("superadmin"));
  await settle();
  const box = screen.getByRole("checkbox", { name: /Let the AI run on its own/ });
  expect(box.checked).toBe(false);
  mockApi.mockResolvedValue(data({ auto: true, by: "owner@x.org", at: "2026-11-17T09:30:00.000Z" }));
  await userEvent.click(box);
  expect(mockApi).toHaveBeenCalledWith("/api/admin/ai/spend", { method: "PUT", body: { auto: true } });
  await settle();
  expect(document.querySelector(".ais-spend").textContent).toMatch(/Lifted by the owner \(owner@x\.org/);
  expect(document.querySelector(".ais-spend").textContent).toMatch(/each automatic feature still obeys its own switch and daily limit/);
});
