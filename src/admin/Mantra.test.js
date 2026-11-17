import React from "react";
import { render, screen } from "@testing-library/react";
import Mantra from "./Mantra";
import { HANUMAN_BEEJ } from "./mantraText";

test("the strip shows the mantra alone — no caption — and says what it is for screen readers", () => {
  const { container } = render(<Mantra className="adm-mantra" />);
  expect(screen.getByText(HANUMAN_BEEJ)).toBeTruthy();
  expect(container.textContent).toBe(HANUMAN_BEEJ);
  expect(container.querySelector("p").getAttribute("aria-label")).toMatch(/हनुमान बीज मंत्र/);
  expect(container.querySelector("p").className).toBe("adm-mantra");
});
