import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FigureBand, PageBar, PageHead, PagePart, SectionHead, usePageTab } from "./PageKit";

afterEach(() => {
  try {
    sessionStorage.clear();
  } catch (_) {
    /* no storage */
  }
  window.history.replaceState(null, "", "/");
});

test("the head card: title, one line, actions, and what sits under it", () => {
  render(
    <PageHead title="Research" text="Prepare the next session." actions={<button type="button">Run</button>}>
      <p>chips here</p>
    </PageHead>
  );
  expect(screen.getByRole("heading", { name: "Research" })).toBeTruthy();
  expect(screen.getByText("Prepare the next session.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  expect(screen.getByText("chips here")).toBeTruthy();
});

test("the sticky bar: the label, the figures with their tone, secondary ones marked, tabs that switch", () => {
  const onTab = jest.fn();
  render(
    <PageBar
      label="Pre-market"
      labelTitle="Session"
      kpis={[
        { label: "Net", value: "+₹4,333", tone: "up" },
        { label: "Drawdown", value: "−₹9,499", tone: "down", more: true },
        { label: "Empty", value: null },
      ]}
      tabs={[
        { id: "a", label: "Overview" },
        { id: "b", label: "Trades", count: 11 },
      ]}
      tab="a"
      onTab={onTab}
      updatedAt={Date.parse("2026-11-23T14:05:00Z")}
      onRefresh={() => {}}
    />
  );
  const bar = screen.getByRole("region", { name: "This page at a glance" });
  expect(bar.textContent).toMatch(/Session/);
  expect(bar.textContent).toMatch(/Pre-market/);
  expect(screen.getByText("Net").closest("div").className).toMatch(/is-up/);
  expect(screen.getByText("Drawdown").closest("div").className).toMatch(/wk-bar__more/);
  expect(screen.getByText("Empty").closest("div").textContent).toMatch(/—/);
  expect(bar.textContent).toMatch(/7:35/); // the time it was read, in IST
  const tabs = screen.getAllByRole("tab");
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[1].textContent).toMatch(/Trades11/);
  fireEvent.click(tabs[1]);
  expect(onTab).toHaveBeenCalledWith("b");
  expect(screen.getByRole("button", { name: "Read again now" })).toBeTruthy();
});

function Tabs({ ids = ["all", "one", "two"] }) {
  const [tab, setTab] = usePageTab("test-page", ids);
  return (
    <>
      <p data-testid="tab">{tab}</p>
      <button type="button" onClick={() => setTab("two")}>
        to two
      </button>
      <PagePart id="all" tab={tab}>
        everything
      </PagePart>
      <PagePart id="one" tab={tab} all="all">
        part one
      </PagePart>
      <PagePart id="two" tab={tab} all="all">
        part two
      </PagePart>
    </>
  );
}

test("tab sections stay mounted: hidden when closed, shown under their tab or the 'everything' tab", () => {
  render(<Tabs />);
  expect(screen.getByTestId("tab").textContent).toBe("all");
  expect(screen.getByText("part one").hidden).toBe(false);
  expect(screen.getByText("part two").hidden).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "to two" }));
  expect(screen.getByText("part one").hidden).toBe(true); // still in the page
  expect(screen.getByText("part two").hidden).toBe(false);
  expect(screen.getByText("everything").hidden).toBe(true);
});

test("the open section is remembered for the visit, and ?part= in the address wins", () => {
  const { unmount } = render(<Tabs />);
  fireEvent.click(screen.getByRole("button", { name: "to two" }));
  unmount();
  render(<Tabs />);
  expect(screen.getByTestId("tab").textContent).toBe("two");
  window.history.replaceState(null, "", "/?part=one");
  const again = render(<Tabs />);
  expect(again.getAllByTestId("tab")[1].textContent).toBe("one");
});

test("a section head and the Console band", () => {
  render(
    <>
      <SectionHead title="Your money over time" sub="running profit after charges" />
      <FigureBand items={[{ label: "Realised P&L", value: "+5.87k", tone: "up" }, { label: "Charges", value: "1.54k" }]} />
    </>
  );
  expect(screen.getByRole("heading", { name: "Your money over time" })).toBeTruthy();
  expect(screen.getByText("running profit after charges")).toBeTruthy();
  expect(screen.getByText("Realised P&L").closest("div").className).toMatch(/is-up/);
});
