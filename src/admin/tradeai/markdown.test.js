import React from "react";
import { render, screen } from "@testing-library/react";
import Markdown, { parseBlocks } from "./markdown";

test("blocks: headings, lists, a table, a quote, a rule and paragraphs", () => {
  const b = parseBlocks("**Hold** while 799 holds.\n\n### Levels\n| Level | Price | Change |\n|---|---:|---|\n| VWAP | 803.2 | +0.4% |\n| S1 | 799 | -0.8% |\n\n- one\n- two\n  - nested\n1. first\n2. second\n\n> careful\n\n---\nlast line");
  expect(b.map((x) => x.type)).toEqual(["p", "h", "table", "ul", "ol", "quote", "hr", "p"]);
  const t = b[2];
  expect(t.head).toEqual(["Level", "Price", "Change"]);
  expect(t.align[1]).toBe("right");
  expect(t.rows).toHaveLength(2);
  expect(b[3].items[1].sub.items[0].text).toBe("nested");
});

test("renders tables with coloured signed figures, bold and safe links only", () => {
  render(<Markdown text={"Up **+1.2%** today, down -₹300 on INFY.\n\n| Stock | P&L |\n|---|---|\n| SBIN | +₹240 |\n| INFY | -₹300 |\n\nSee [docs](https://example.com) and [bad](javascript:alert(1)) and <b>raw</b> 9:15-9:30."} />);
  expect(screen.getByRole("table")).toBeTruthy();
  const up = screen.getByText("+₹240");
  expect(up.closest("td").className).toMatch(/md-up/);
  expect(screen.getByText("-₹300", { selector: "td span, td" }).closest("td").className).toMatch(/md-down/);
  expect(screen.getByText("docs").getAttribute("href")).toBe("https://example.com");
  expect(screen.getByText("docs").getAttribute("rel")).toMatch(/noopener/);
  expect(screen.queryByText("bad")).toBeNull(); // not a link: stays as text
  expect(document.querySelector("b")).toBeNull(); // raw HTML is never markup
  expect(screen.getByText(/<b>raw<\/b>/)).toBeTruthy();
  expect(document.querySelectorAll(".md-down").length).toBeGreaterThanOrEqual(2); // -₹300 in text and table, but not 9:15-9:30
  expect(document.body.textContent).toContain("9:15-9:30");
});
