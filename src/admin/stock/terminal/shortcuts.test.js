import { keyAction } from "./shortcuts";

const press = (key, extra = {}) => keyAction({ key, target: { tagName: "BODY" }, ...extra });

test("single keys map to terminal actions", () => {
  expect(press("/")).toEqual({ action: "search" });
  expect(press("b")).toEqual({ action: "buy" });
  expect(press("S")).toEqual({ action: "sell" });
  expect(press("d")).toEqual({ action: "dock" });
  expect(press("t")).toEqual({ action: "theme" });
  expect(press("?")).toEqual({ action: "help" });
  expect(press("3")).toEqual({ action: "view", view: 3 });
  expect(press("7")).toBe(null);
  expect(press("x")).toBe(null);
});

test("typing in a field, or holding a modifier, is never a command", () => {
  expect(press("b", { target: { tagName: "INPUT" } })).toBe(null);
  expect(press("s", { target: { tagName: "TEXTAREA" } })).toBe(null);
  expect(press("1", { target: { tagName: "DIV", isContentEditable: true } })).toBe(null);
  expect(press("b", { ctrlKey: true })).toBe(null);
  expect(press("s", { metaKey: true })).toBe(null);
  // Esc still closes things from inside a field
  expect(press("Escape", { target: { tagName: "INPUT" } })).toEqual({ action: "close" });
});

test("nothing global fires while a dialog is open", () => {
  const d = document.createElement("div");
  d.setAttribute("aria-modal", "true");
  document.body.appendChild(d);
  expect(press("b")).toBe(null);
  expect(press("Escape")).toEqual({ action: "close" });
  d.remove();
  expect(press("b")).toEqual({ action: "buy" });
});
