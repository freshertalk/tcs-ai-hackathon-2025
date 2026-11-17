import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DayBoard, { ZONES, istParts, radarPicks, sessionNow, zoneAt } from "./DayBoard";
import ConnectPanel from "./ConnectPanel";

jest.mock("../../api", () => ({ api: () => Promise.resolve({ available: false, reason: "no quote yet" }) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));

const at = (h, m, dow = 2) => ({ min: h * 60 + m, sec: 0, dow, date: "2026-11-17", text: `${h}:${String(m).padStart(2, "0")}` });

test("the trading day is covered by its zones without a gap from 9:15 to 3:30", () => {
  expect(ZONES[0].from).toBe(9 * 60 + 15);
  expect(ZONES[ZONES.length - 1].to).toBe(15 * 60 + 30);
  for (let i = 1; i < ZONES.length; i += 1) expect(ZONES[i].from).toBe(ZONES[i - 1].to);
  expect(zoneAt(9 * 60 + 14)).toBeNull();
  expect(zoneAt(9 * 60 + 15).id).toBe("open");
  expect(zoneAt(10 * 60).id).toBe("prime");
  expect(zoneAt(12 * 60).id).toBe("lull");
  expect(zoneAt(15 * 60 + 25).id).toBe("sq");
  expect(zoneAt(15 * 60 + 30)).toBeNull();
});

test("istParts reads India time, not the computer's", () => {
  const p = istParts(Date.parse("2026-11-17T04:00:00Z")); // 9:30 in India
  expect(p).toMatchObject({ min: 9 * 60 + 30, dow: 2, date: "2026-11-17", text: "09:30" });
});

test("the session says where the day is: open zones, pre-open, closed and the next open", () => {
  const open = sessionNow(at(10, 0), true);
  expect(open).toMatchObject({ phase: "open", title: "Prime window", tone: "up" });
  expect(open.nextLabel).toBe("5 h 30 min to the close");
  expect(open.mark).toBeGreaterThan(0.1);
  expect(sessionNow(at(15, 22), true).title).toBe("Square-off");
  expect(sessionNow(at(9, 5), false)).toMatchObject({ phase: "pre", title: "Pre-open" });
  expect(sessionNow(at(18, 0), false)).toMatchObject({ phase: "closed", nextLabel: "next: tomorrow 9:15" });
  expect(sessionNow(at(18, 0, 5), false).nextLabel).toBe("next: Monday 9:15");
  expect(sessionNow(at(7, 0, 1), false).nextLabel).toBe("next: today 9:15");
  // a weekday the exchange is shut (the server says so): closed, whatever the clock
  expect(sessionNow(at(11, 0), false).phase).toBe("closed");
});

test("the radar ranks the watchlist against the Nifty and ignores stocks that have not traded", () => {
  const q = (open, last, avgPrice, high, low) => ({ open, last, avgPrice, high, low });
  const quotes = {
    "NIFTY 50": q(100, 100.1),
    UP: q(100, 103, 101.5, 103.2, 99.8),
    DOWN: q(100, 97, 98.5, 100.2, 96.8),
    FLAT: q(100, 100.05, 100.02, 100.4, 99.7),
    NOQUOTE: null,
  };
  const r = radarPicks(["UP", "DOWN", "FLAT", "NOQUOTE", "MISSING"], quotes);
  expect(r.strong.map((x) => x.symbol)).toEqual(["UP"]);
  expect(r.weak.map((x) => x.symbol)).toEqual(["DOWN"]);
});

const status = (over = {}) => ({ mode: "kite", marketHours: true, kite: { configured: true, user: "Test User", expiresAt: "2026-11-18T00:30:00Z" }, ...over });

test("the board shows the four cards, and the radar chip opens its stock", async () => {
  const onPick = jest.fn();
  const quotes = { "NIFTY 50": { open: 100, last: 100 }, UP: { open: 100, last: 103, avgPrice: 101.5, high: 103.2, low: 99.8 } };
  render(<DayBoard status={status()} quotes={quotes} symbols={["UP"]} onPick={onPick} />);
  await act(async () => Promise.resolve());
  expect(screen.getByLabelText("Trading session")).toBeTruthy();
  expect(screen.getByLabelText("Market gauge")).toBeTruthy();
  expect(screen.getByLabelText("Watchlist radar")).toBeTruthy();
  expect(screen.getByLabelText("Pre-trade checklist")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /^UP/ }));
  expect(onPick).toHaveBeenCalledWith("UP");
});

test("the checklist is kept for the day and can be reset", async () => {
  window.localStorage.clear();
  render(<DayBoard status={status()} quotes={{}} symbols={[]} onPick={() => {}} />);
  await act(async () => Promise.resolve());
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes).toHaveLength(5);
  await userEvent.click(boxes[0]);
  await userEvent.click(boxes[1]);
  expect(screen.getByLabelText("Pre-trade checklist").textContent).toMatch(/2\/5/);
  expect(JSON.parse(window.localStorage.getItem("dkb-checks")).done).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByLabelText("Pre-trade checklist").textContent).toMatch(/0\/5/);
});

/* ---------------------------------------------------------------- the connection button and its dialog */

const panel = (st, extra = {}) => <ConnectPanel status={st} flash={null} onStatus={() => {}} startOpen={false} {...extra} />;

test("connected: a very small button, and nothing else until it is pressed", async () => {
  render(panel(status()));
  const btn = screen.getByRole("button", { name: /Live data from Zerodha/ });
  expect(btn.textContent).toBe("");
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(btn);
  const dlg = screen.getByRole("dialog");
  expect(dlg.textContent).toMatch(/Live data from Zerodha/);
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zerodha setup" })).toBeTruthy();
});

test("the dialog closes with Escape, the × and a click outside, and gives focus back", async () => {
  render(panel(status()));
  const btn = screen.getByRole("button", { name: /Live data from Zerodha/ });
  await userEvent.click(btn);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(btn);
  await userEvent.click(btn);
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(btn);
  fireEvent.mouseDown(document.querySelector(".conn-modal"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("not connected: the button says what to do, and the dialog opens by itself when nothing is set up", async () => {
  const none = { mode: "none", marketHours: false, redirectUrl: "http://x/cb", kite: { configured: false } };
  render(panel(none, { startOpen: true }));
  expect(screen.getByRole("button", { name: /No market data connected/ }).textContent).toBe("Connect");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Get a Kite Connect API key")).toBeTruthy();
});

test("the result of a Kite login opens the dialog with its message", () => {
  render(panel(status(), { flash: { kind: "ok", text: "Zerodha connected. Live data is on until 6 AM tomorrow." } }));
  expect(screen.getByRole("dialog").textContent).toMatch(/Zerodha connected/);
});
