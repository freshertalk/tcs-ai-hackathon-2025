import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AutomationCard from "./AutomationCard";

const mockApi = jest.fn();
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));

const data = {
  lastSession: "2026-11-18",
  running: null,
  systems: [
    { id: "zerodha", name: "Zerodha session", schedule: "You log in once each trading morning", state: "needs-you", detail: "Not connected" },
    { id: "horizon", name: "15-minute forecaster", schedule: "A forecast on every finished 5-minute bar", state: "on", detail: "learned to 2026-11-18" },
    { id: "ai", name: "AI models (paid)", schedule: "Only when you press an AI button", state: "click-only", detail: "protected" },
  ],
  duties: [
    { id: "forecaster-learn", name: "15-minute forecaster: evening learning", what: "Learns every stored session the model has not seen.", state: "waiting", reason: "sessions to 2026-11-18 are stored, learned only to 2026-11-17", lastOkAt: null, lastError: "", nextAt: null },
    { id: "setup-lab", name: "Set-up lab", what: "Measures every classic set-up.", state: "ok", reason: "", lastOkAt: "2026-11-18T12:00:00Z", lastError: "", nextAt: null },
  ],
  events: [{ at: "2026-11-18T12:00:00Z", id: "setup-lab", name: "Set-up lab", kind: "done", reason: "not measured" }],
};

test("the card lists what runs by itself, what is behind and why, what the supervisor did — and the owner can ask it to look now", async () => {
  mockApi.mockResolvedValue(data);
  render(<AutomationCard />);
  expect(await screen.findByText("Zerodha session")).toBeTruthy();
  expect(screen.getByText(/2 of 3 systems running by themselves · 1 catching up/)).toBeTruthy();
  expect(screen.getByText("Needs you")).toBeTruthy();
  expect(screen.getByText("Click only")).toBeTruthy();
  expect(screen.getByText("Waits for the close")).toBeTruthy();
  expect(screen.getByText(/Behind: sessions to 2026-11-18 are stored/)).toBeTruthy();
  expect(screen.getByText(/What the supervisor did/)).toBeTruthy();
  expect(screen.getByText(/Nothing here places an order/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Look now" }));
  });
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/admin/automation/run", { method: "POST" }));
});
