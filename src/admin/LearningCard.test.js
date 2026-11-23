import React from "react";
import { render, screen } from "@testing-library/react";
import LearningCard, { LEARNING } from "./LearningCard";

test("three groups of outside resources, each card opening its site in a new tab, safely", () => {
  render(<LearningCard />);
  expect(screen.getByRole("heading", { name: "Learning", level: 2 })).toBeTruthy();
  for (const g of ["Learning", "Technical Analysis", "Fundamental Analysis"]) expect(screen.getByRole("group", { name: new RegExp(`^${g}`) })).toBeTruthy();
  // the owner's own learning comes first and stays inside the site; the outside resources open in a new tab
  const own = screen.getByRole("link", { name: /Vinaypedia/ });
  expect(own.getAttribute("href")).toBe("/me/stock-report?view=learning");
  expect(own.getAttribute("target")).toBeNull();
  const links = screen.getAllByRole("link").filter((a) => a !== own);
  expect(links).toHaveLength(11);
  expect(LEARNING.flatMap((g) => g.links).map((l) => l.url)).toEqual([
    "https://zerodha.com/varsity/",
    "https://groww.in/",
    "https://www.investopedia.com/",
    "https://www.tradingview.com/",
    "https://chartink.com/",
    "https://stockedge.com/",
    "https://www.moneycontrol.com/",
    "https://www.tickertape.in/",
    "https://www.screener.in/",
    "https://trendlyne.com/",
    "https://www.tijorifinance.com/?r=n",
  ]);
  for (const a of links) {
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toMatch(/\(opens in a new tab\)$/);
  }
  const varsity = screen.getByRole("link", { name: /Zerodha Varsity/ });
  expect(varsity.getAttribute("href")).toBe("https://zerodha.com/varsity/");
  expect(varsity.textContent).toMatch(/zerodha\.com/);
});
