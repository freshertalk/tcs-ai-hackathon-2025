import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SystemRow from "./SystemRow";

const mockData = {
  "/api/admin/health": { overall: "warn", counts: { ok: 14, warn: 2, error: 0, off: 5 }, checks: [], at: "2026-11-18T05:00:00Z" },
  "/api/admin/whatsapp": { configured: true, enabled: true, every: 30, lastSent: new Date(Date.now() - 600000).toISOString(), allowTrading: false },
  "/api/admin/notify": { configured: true, lastSent: null, lastError: "" },
  "/api/admin/temple": { source: { kind: "library", label: "x" }, library: [{ id: "a" }, { id: "b" }], volume: 0.05, autoplay: true },
};
jest.mock("./api", () => ({ api: (url) => Promise.resolve(mockData[url] || {}) }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./HealthCard", () => () => <div>FULL HEALTH CARD</div>);
jest.mock("./WhatsAppCard", () => () => <div>FULL WHATSAPP CARD</div>);
jest.mock("./NotifyCard", () => () => <div>FULL TELEGRAM CARD</div>);
jest.mock("./temple/TempleCard", () => () => <div>FULL MANDIR CARD</div>);

const settle = () => act(async () => Promise.resolve());

test("four tiles show the live state; pressing one opens its full card under the row, one at a time", async () => {
  render(<SystemRow isSuper />);
  await settle();
  const row = screen.getByLabelText("System cards");
  expect(row.querySelectorAll("li")).toHaveLength(4);
  expect(row.textContent).toMatch(/14 working/);
  expect(row.textContent).toMatch(/2 to look at/);
  expect(row.textContent).toMatch(/updates every 30 min/);
  expect(row.textContent).toMatch(/price alerts · risk guard · day report/);
  expect(row.textContent).toMatch(/2 files/);
  expect(screen.queryByText("FULL HEALTH CARD")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Site health/ }));
  expect(screen.getByText("FULL HEALTH CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /WhatsApp Trading/ }));
  expect(screen.queryByText("FULL HEALTH CARD")).toBeNull();
  expect(screen.getByText("FULL WHATSAPP CARD")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /WhatsApp Trading/ }));
  expect(screen.queryByText("FULL WHATSAPP CARD")).toBeNull();
});

test("an admin who is not the owner gets only the health and Mandir tiles", async () => {
  render(<SystemRow isSuper={false} />);
  await settle();
  const row = screen.getByLabelText("System cards");
  expect(row.querySelectorAll("li")).toHaveLength(2);
  expect(row.textContent).not.toMatch(/WhatsApp|phone/);
});
