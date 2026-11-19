import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PageJumps, { readSections, sectionName } from "./PageJumps";

test("a section's short name: the given one, else the words before the first separator, never too long", () => {
  expect(sectionName("Live scanner · NIFTY 100")).toBe("Live scanner");
  expect(sectionName("Trade Analysis — Execution Lab")).toBe("Trade Analysis");
  expect(sectionName("RSI search (NIFTY 500): today")).toBe("RSI search");
  expect(sectionName("  Set-ups   measured on this desk  ", [[/^set-ups measured/i, "Set-ups"]])).toBe("Set-ups");
  expect(sectionName("Nothing is prepared for this session yet", [[/^nothing is prepared/i, ""]])).toBe("");
  expect(sectionName("A very long title with no separator at all in it")).toBe("A very long title with…");
  expect(sectionName("")).toBe("");
});

function Page({ extra = false }) {
  return (
    <div className="tm">
      <div className="tm-page">
        <PageJumps names={[[/^set-ups measured/i, "Set-ups"], [/^nothing is prepared/i, ""]]} skip=".no-jump" />
        <section className="an-card">
          <h3>Autopilot</h3>
          {/* a card inside a card is part of its parent */}
          <section className="an-card">
            <h3>Limits</h3>
          </section>
        </section>
        <section className="an-card">
          <h3>Live scanner · NIFTY 100</h3>
        </section>
        <section className="an-card">
          <h3>Set-ups measured on this desk</h3>
        </section>
        <section className="an-card no-jump">
          <h3>Left out</h3>
        </section>
        <section className="an-card">
          <p>No title: no jump.</p>
        </section>
        <section className="an-card">
          <h3>Nothing is prepared for this session yet</h3>
        </section>
        <details className="rs-ai">
          <summary>15-minute forecaster — what it has learned</summary>
          <p>Inside.</p>
        </details>
        <div data-jump="Stock notes">notes</div>
        {extra && (
          <section className="an-card">
            <h3>Top 10 · stocks to trade</h3>
          </section>
        )}
      </div>
    </div>
  );
}

test("the row is read from the page: top-level titled sections only, in order — and it follows the page as it fills in", async () => {
  jest.useFakeTimers();
  window.scrollTo = jest.fn();
  const { container, rerender } = render(<Page />);
  const names = () => [...container.querySelectorAll(".pj button")].map((b) => b.textContent);
  expect(names()).toEqual(["Autopilot", "Live scanner", "Set-ups", "15-minute forecaster", "Stock notes"]);
  expect(readSections(container.querySelector(".tm-page")).map((x) => x.name)).toContain("Left out"); // without the page's own skip list
  expect(container.querySelector(".pj").hidden).toBe(false);
  // a section that arrives later gets its jump
  rerender(<Page extra />);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(names()).toEqual(["Autopilot", "Live scanner", "Set-ups", "15-minute forecaster", "Stock notes", "Top 10"]);
  // a jump goes there at once, opens a folded section, and marks where you are
  fireEvent.click(screen.getByRole("button", { name: "15-minute forecaster" }));
  expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  expect(container.querySelector("details.rs-ai").open).toBe(true);
  expect(screen.getByRole("button", { name: "15-minute forecaster" }).getAttribute("aria-current")).toBe("true");
  // the row tells the terminal its height (for whatever is sticky under it), and takes it back when it leaves
  expect(container.querySelector(".tm").style.getPropertyValue("--pj-h")).toBe("0px"); // no layout in this test: its height is 0
  jest.useRealTimers();
});

test("a short page gets no row at all", () => {
  const { container } = render(
    <div className="tm">
      <div className="tm-page">
        <PageJumps />
        <section className="an-card">
          <h3>One</h3>
        </section>
        <section className="an-card">
          <h3>Two</h3>
        </section>
      </div>
    </div>
  );
  expect(container.querySelector(".pj").hidden).toBe(true);
  expect(container.querySelector(".tm").style.getPropertyValue("--pj-h")).toBe("0px");
});
