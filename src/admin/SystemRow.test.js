import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SystemRow from "./SystemRow";

const mockData = {
  "/api/admin/health": { overall: "warn", counts: { ok: 14, warn: 2, error: 0, off: 5 }, checks: [], at: "2026-11-18T05:00:00Z" },
  "/api/admin/whatsapp": { configured: true, enabled: true, every: 30, lastSent: new Date(Date.now() - 600000).toISOString(), allowTrading: false },
  "/api/admin/notify": { configured: true, lastSent: null, lastError: "" },
  "/api/admin/automation": { duties: [{ id: "a", name: "Set-up lab", state: "ok" }, { id: "b", name: "Level learner", state: "behind", reason: "1 trading day not studied" }], systems: [{ id: "zerodha", state: "on" }, { id: "horizon", state: "on" }, { id: "paper", state: "off" }], events: [], running: null },
  "/api/admin/recorder": { state: "recording", today: { taken: 142 }, stored: { sessions: 12 }, learner: { on: false, days: 3 } },
  "/api/admin/vault/status": { settings: { auto: true, keep: 5 }, last: { at: new Date(Date.now() - 3 * 3600000).toISOString() }, error: "" },
  "/api/admin/temple": { source: { kind: "library", label: "x" }, library: [{ id: "a" }, { id: "b" }], volume: 0.05, autoplay: true },
};
jest.mock("./api", () => ({ api: (url) => Promise.resolve(mockData[url] || {}) }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./HealthCard", () => () => <div>FULL HEALTH CARD</div>);
jest.mock("./WhatsAppCard", () => () => <div>FULL WHATSAPP CARD</div>);
jest.mock("./NotifyCard", () => () => <div>FULL TELEGRAM CARD</div>);
jest.mock("./temple/TempleCard", () => () => <div>FULL MANDIR CARD</div>);
jest.mock("./AutomationCard", () => () => <div>FULL AUTOMATION CARD</div>);
jest.mock("./DataCard", () => () => <div>FULL DATA CARD</div>);

const settle = () => act(async () => Promise.resolve());

test("the tiles show the live state; pressing one opens its full card under the row, one at a time", async () => {
  render(<SystemRow isSuper />);
  await settle();
  const row = screen.getByLabelText("System cards");
  expect(row.querySelectorAll("li")).toHaveLength(6);
  expect(row.textContent).toMatch(/14 working/);
  expect(row.textContent).toMatch(/Recording · 142 min today/);
  expect(row.textContent).toMatch(/order book & OI: 3 learned, not proven yet · backup 3 h ago/);
  expect(row.textContent).toMatch(/1 catching up/);
  expect(row.textContent).toMatch(/Level learner/);
  expect(row.textContent).toMatch(/2 to look at/);
  expect(row.textContent).toMatch(/updates every 30 min/);
  expect(row.textContent).toMatch(/price alerts · risk guard · day report/);
  expect(row.textContent).toMatch(/2 files/);
  expect(screen.queryByText("FULL HEALTH CARD")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Site health/ }));
  expect(screen.getByText("FULL HEALTH CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Automation/ }));
  expect(screen.getByText("FULL AUTOMATION CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Data & backups/ }));
  expect(screen.getByText("FULL DATA CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /WhatsApp Trading/ }));
  expect(screen.queryByText("FULL HEALTH CARD")).toBeNull();
  expect(screen.getByText("FULL WHATSAPP CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /WhatsApp Trading/ }));
  expect(screen.queryByText("FULL WHATSAPP CARD")).toBeNull();
});

test("an admin who is not the owner gets the health, automation, data and Mandir tiles — not the owner's messaging", async () => {
  render(<SystemRow isSuper={false} />);
  await settle();
  const row = screen.getByLabelText("System cards");
  expect(row.querySelectorAll("li")).toHaveLength(4);
  expect(row.textContent).not.toMatch(/WhatsApp|phone/);
  expect(row.textContent).toMatch(/Recording · 142 min today/);
  expect(row.textContent).not.toMatch(/backup 3 h ago/); // backups are the owner's
});
