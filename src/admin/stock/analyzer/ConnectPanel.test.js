import React from "react";
import { render, screen } from "@testing-library/react";
import ConnectPanel from "./ConnectPanel";

const mockSnack = jest.fn();
jest.mock("../../api", () => ({ api: jest.fn() }));
jest.mock("../../ux/snack", () => ({ snack: (...a) => mockSnack(...a) }));

const live = { mode: "kite", demo: false, kite: { configured: true, user: "Sample", expiresAt: "2026-11-29T00:30:00.000Z" } };
const wrap = (ui) => render(<div className="adm">{ui}</div>);

beforeEach(() => mockSnack.mockReset());

test("after a successful Kite login the Desk stays clear: a short note, no dialog over the page", () => {
  wrap(<ConnectPanel status={live} flash={{ kind: "ok", text: "Zerodha connected." }} onStatus={() => {}} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mockSnack).toHaveBeenCalledWith("Zerodha connected.", expect.objectContaining({ tone: "ok" }));
});

test("a failed login opens the dialog, drawn at the private area's root (not inside the Desk, where a moving page could hide it)", () => {
  const { container } = wrap(<ConnectPanel status={{ ...live, mode: "none" }} flash={{ kind: "error", text: "The Kite login did not complete." }} onStatus={() => {}} />);
  const dlg = screen.getByRole("dialog", { name: /Market data connection/ });
  expect(dlg.closest(".tr-modal").parentElement).toBe(container.querySelector(".adm"));
  expect(mockSnack).not.toHaveBeenCalled();
});
