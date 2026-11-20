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

test("the one exception has its own block: the AI read of a stock you open, with its limits, its record and the owner's switch", async () => {
  const open = { mode: "need", perDay: 40, gapMin: 15, everyone: false, ready: true, usedToday: 6, record: { n: 20, ok: 12, right: 0.6 } };
  mockApi.mockImplementation((url, opts) => (opts && opts.method === "PUT" && url === "/api/admin/market/evidence/ai" ? Promise.resolve({ ...open, mode: "off" }) : Promise.resolve(data({ open }))));
  render(page());
  await settle();
  const text = () => document.querySelector(".ais-open").textContent;
  expect(document.querySelector(".ais-spend").textContent).toMatch(/The one exception you asked for is described below: a stock you open on the Desk\./);
  expect(text()).toMatch(/On — the one exception, at your instruction\. When you open a stock on the Desk during market hours and its readings are undecided or in conflict/);
  expect(text()).toMatch(/Never on a timer and never for a stock nobody opened\. At most 40 a day, and one read per stock every 15 minutes\./);
  expect(text()).toMatch(/Used today: 6 of 40\. Checked 15 minutes later, its reads were right 60% of 20 times\./);
  // the owner turns it off: one deliberate request, and the card says so
  await act(async () => {
    await userEvent.selectOptions(screen.getByLabelText("When a stock is opened"), "off");
  });
  await settle();
  expect(mockApi.mock.calls.some((c) => c[0] === "/api/admin/market/evidence/ai" && c[1].method === "PUT" && c[1].body.mode === "off")).toBe(true);
  expect(text()).toMatch(/Off\. Opening a stock asks the AI nothing\./);
});

test("someone who is not the owner sees the rule for opened stocks but cannot change it", async () => {
  mockApi.mockResolvedValue(data({ open: { mode: "always", perDay: 10, gapMin: 20, everyone: true, ready: false, usedToday: 0, record: { n: 0, ok: 0, right: null } } }));
  render(page("admin"));
  await settle();
  const text = document.querySelector(".ais-open").textContent;
  expect(text).toMatch(/When anyone signed in opens a stock on the Desk during market hours the AI reads that stock's whole evidence board once/);
  expect(text).toMatch(/No read has been checked yet\. No AI model is set up, so nothing is asked\./);
  expect(screen.queryByLabelText("When a stock is opened")).toBeNull();
});
