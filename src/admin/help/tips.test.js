import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TipLayer, { setTipsEnabled } from "./TipLayer";
import { ALL, keyOf, lookup, SELECTOR } from "./glossary";
import { isInteractive, norm, ownText, place } from "./tips";

/* ------------------------------------------------------------ small helpers */

test("a label becomes a key: case, spacing, a trailing colon and curly quotes do not matter", () => {
  expect(norm("  Range   used: ")).toBe("range used");
  expect(norm("Day’s range (ATR)")).toBe("day's range (atr)");
  expect(norm(null)).toBe("");
  // a leading tick, cross, arrow or plus is decoration, not part of the name
  expect(keyOf("✓ Reached target")).toBe("reached target");
  expect(keyOf("▲ UP")).toBe("up");
  expect(keyOf("+ Add to watchlist")).toBe("add to watchlist");
  expect(keyOf("◦ Closed at 3:15 PM")).toBe("closed at 3:15 pm");
});

test("an element's own text leaves out what its children say", () => {
  const th = document.createElement("th");
  th.innerHTML = "<i></i>R1<small>Pivot</small>";
  expect(ownText(th)).toBe("R1");
  const tab = document.createElement("button");
  tab.innerHTML = "Setups<i>2</i>";
  expect(ownText(tab)).toBe("Setups");
  expect(ownText(document.createElement("dt"))).toBe("");
  expect(ownText(null)).toBe("");
});

test("the bubble sits above its target, centred — and moves to stay inside the window", () => {
  const view = { w: 1000, h: 700 };
  const size = { w: 200, h: 60 };
  // room above: centred over the target, 8px clear of it
  expect(place({ left: 400, top: 300, width: 100, height: 20 }, size, view)).toEqual({ left: 350, top: 232, side: "top", arrow: 100 });
  // no room above: below it
  const low = place({ left: 400, top: 20, width: 100, height: 20 }, size, view);
  expect(low.side).toBe("bottom");
  expect(low.top).toBe(48);
  // hard against the left edge: kept on screen, and the pointer still aims at the target
  const left = place({ left: 0, top: 300, width: 40, height: 20 }, size, view);
  expect(left.left).toBe(8);
  expect(left.arrow).toBe(12);
  // hard against the right edge
  const right = place({ left: 960, top: 300, width: 40, height: 20 }, size, view);
  expect(right.left).toBe(792);
  expect(right.arrow).toBe(188);
  // a phone: a bubble as wide as the screen allows is still placed inside it
  const phone = place({ left: 300, top: 400, width: 60, height: 18 }, { w: 359, h: 80 }, { w: 375, h: 812 });
  expect(phone.left).toBe(8);
  expect(phone.left + 359).toBeLessThanOrEqual(375 - 8);
});

test("buttons, links and tabs are things a tap presses; labels are not", () => {
  const box = document.createElement("div");
  box.innerHTML = '<button><span id="a">x</span></button><a href="/x" id="b">y</a><dt id="c">z</dt><i role="tab" id="d">t</i>';
  expect(isInteractive(box.querySelector("#a"))).toBe(true);
  expect(isInteractive(box.querySelector("#b"))).toBe(true);
  expect(isInteractive(box.querySelector("#d"))).toBe(true);
  expect(isInteractive(box.querySelector("#c"))).toBe(false);
});

/* --------------------------------------------------------------- the glossary */

test("every help text is a short, finished sentence, and no label is explained twice in one place", () => {
  const seen = new Set();
  let count = 0;
  for (const [labels, tip, scope] of ALL.entries) {
    expect(Array.isArray(labels) && labels.length > 0).toBe(true);
    expect(typeof tip).toBe("string");
    expect(tip.length).toBeGreaterThan(15);
    expect(tip.length).toBeLessThanOrEqual(260);
    expect(tip).toMatch(/[.!?”)]$/);
    expect(tip).not.toMatch(/\s{2,}|undefined|\bTODO\b/);
    if (scope) expect(() => document.querySelector(scope)).not.toThrow();
    for (const label of labels) {
      const id = `${keyOf(label)}|${scope || ""}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      count += 1;
    }
  }
  for (const [re, tip] of ALL.patterns) {
    expect(re).toBeInstanceOf(RegExp);
    expect(tip).toMatch(/[.!?”)]$/);
    expect(tip.length).toBeLessThanOrEqual(260);
  }
  expect(count).toBeGreaterThan(200);
  expect(() => document.querySelectorAll(SELECTOR)).not.toThrow();
});

test("nothing in the help promises a profit", () => {
  for (const [, tip] of [...ALL.entries, ...ALL.patterns]) expect(tip).not.toMatch(/guarantee|always wins|sure profit|100%|risk-free|will go up|will rise/i);
});

test("a label is looked up by its text, and by where it is when a word has two meanings", () => {
  expect(lookup("VWAP")).toMatch(/average price paid/);
  expect(lookup("vs VWAP")).toBe(lookup("VWAP"));
  expect(lookup("Range used")).toMatch(/normal day/);
  expect(lookup("nothing the glossary knows")).toBeNull();
  expect(lookup("")).toBeNull();
  expect(lookup("x".repeat(80))).toBeNull();

  const inside = (cls, tag = "button") => {
    const wrap = document.createElement("div");
    wrap.className = cls;
    const el = document.createElement(tag);
    wrap.appendChild(el);
    return el;
  };
  // "Setups" is a tab of the stock, and a switch on the daily chart
  expect(lookup("Setups", inside("sv__tabs"))).toMatch(/Seven rule-based/);
  expect(lookup("Setups", inside("pc__toggles"))).toMatch(/Mark the days/);
  expect(lookup("Setups", inside("elsewhere"))).toBeNull();
  // "Reached target" counts replayed calls in the debrief, and AI plans elsewhere
  expect(lookup("✓ Reached target", inside("db", "dt"))).toMatch(/1R target/);
  expect(lookup("Reached target", inside("ai", "dt"))).toMatch(/Plans whose first target/);
  // "Opening range" is a tile and a factor of the score
  expect(lookup("Opening range", inside("vd-tiles", "dt"))).toMatch(/first 15 minutes/);
  expect(lookup("Opening range", inside("vd-factors", "b"))).toMatch(/±20 points/);
  // words that only mean something in one place say nothing elsewhere
  expect(lookup("Open", inside("sv__stats", "dt"))).toMatch(/first traded price/);
  expect(lookup("Open", inside("somewhere", "dt"))).toBeNull();
  expect(lookup("▲ UP", inside("cp", "span"))).toMatch(/next 10–15 minutes/);
  expect(lookup("UP", inside("other", "span"))).toBeNull();
});

test("labels with a changing part are matched by pattern", () => {
  expect(lookup("Target 2R")).toMatch(/times the risk/);
  expect(lookup("Target 1.5R")).toMatch(/times the risk/);
  expect(lookup("Level: R1")).toMatch(/nearby price level/);
  expect(lookup("Buy at the current price")).toMatch(/entry price/);
  expect(lookup("Sell on a bounce")).toMatch(/entry price/);
  expect(lookup("Build strategy for HINDCOPPER")).toMatch(/write a plan/);
  expect(lookup("Check the news on SBIN")).toMatch(/web search/);
  expect(lookup("Resistance (3×)")).toMatch(/turned that many times/);
  expect(lookup("⚠ Weakening — early warning against this trade")).toMatch(/First signs/);
  expect(lookup("9.4 years, per year")).toMatch(/compound yearly growth/);
  expect(lookup("vs NIFTY 50, 12 months")).toMatch(/beat the market/);
  expect(lookup("Oversold ≤ 30")).toMatch(/common search/);
  expect(lookup("Target practice")).toBeNull();
});

/* ------------------------------------------------------------------ the layer */

function Page({ more = false }) {
  return (
    <div className="adm">
      <dl className="vd-tiles">
        <div>
          <dt>Range used</dt>
          <dd>120%</dd>
        </div>
        {more && (
          <div>
            <dt>Volume pace</dt>
            <dd>1.4×</dd>
          </div>
        )}
      </dl>
      <p>
        <span className="callchip">LONG in play</span>
      </p>
      <button type="button" data-tip="Help written in the markup.">
        Ask now
      </button>
      <button type="button" aria-label="Remove SBIN from the watchlist">
        ×
      </button>
      <p title="A plain title.">hover me</p>
      <p>plain text</p>
      <TipLayer />
    </div>
  );
}
const rest = (el) => {
  act(() => {
    fireEvent.pointerOver(el);
  });
  act(() => {
    jest.advanceTimersByTime(500);
  });
};

describe("the hover help", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("labels the glossary knows are given their help as the page draws; help in the markup is left alone", () => {
    render(<Page />);
    const dt = screen.getByText("Range used");
    expect(dt.getAttribute("data-tip")).toMatch(/normal day/);
    expect(dt.hasAttribute("data-tip-auto")).toBe(true);
    expect(screen.getByText("LONG in play").getAttribute("data-tip")).toMatch(/conditions for a long/);
    const explicit = screen.getByText("Ask now");
    expect(explicit.getAttribute("data-tip")).toBe("Help written in the markup.");
    expect(explicit.hasAttribute("data-tip-auto")).toBe(false);
    expect(screen.getByText("plain text").hasAttribute("data-tip")).toBe(false);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("resting the pointer shows the bubble after a moment; moving away puts it away", () => {
    render(<Page />);
    const dt = screen.getByText("Range used");
    act(() => {
      fireEvent.pointerOver(dt);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toMatch(/normal day/);
    expect(tip.id).toBe("adm-tip");
    expect(dt.getAttribute("aria-describedby")).toBe("adm-tip");
    act(() => {
      fireEvent.pointerOut(dt);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(dt.hasAttribute("aria-describedby")).toBe(false);
    // a pointer that only passes over does not open it
    act(() => {
      fireEvent.pointerOver(dt);
      jest.advanceTimersByTime(100);
      fireEvent.pointerOver(screen.getByText("plain text"));
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("a plain title and a symbol-only button are explained the same way", () => {
    render(<Page />);
    const titled = screen.getByText("hover me");
    rest(titled);
    expect(screen.getByRole("tooltip").textContent).toBe("A plain title.");
    expect(titled.hasAttribute("title")).toBe(false);
    const x = screen.getByText("×");
    rest(x);
    expect(screen.getByRole("tooltip").textContent).toBe("Remove SBIN from the watchlist");
    expect(x.hasAttribute("aria-describedby")).toBe(false);
  });

  test("Escape, a press and scrolling all put the bubble away", () => {
    render(<Page />);
    const dt = screen.getByText("Range used");
    for (const away of [() => fireEvent.keyDown(document.body, { key: "Escape" }), () => fireEvent.pointerDown(dt), () => fireEvent.scroll(window)]) {
      rest(dt);
      expect(screen.getByRole("tooltip")).toBeTruthy();
      act(() => {
        away();
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => {
        fireEvent.pointerOut(dt);
      });
    }
  });

  test("on a touch screen a tap on a label shows its help, and a tap on a button just presses it", () => {
    render(<Page />);
    const dt = screen.getByText("Range used");
    const tap = (el) =>
      act(() => {
        const down = new Event("pointerdown", { bubbles: true });
        Object.defineProperty(down, "pointerType", { value: "touch" });
        el.dispatchEvent(down);
        fireEvent.click(el);
        jest.advanceTimersByTime(50);
      });
    tap(dt);
    expect(screen.getByRole("tooltip").textContent).toMatch(/normal day/);
    tap(screen.getByText("plain text"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    tap(screen.getByText("Ask now"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("switched off, nothing shows and nothing is marked; switched on again it works", () => {
    render(<Page />);
    act(() => setTipsEnabled(false));
    rest(screen.getByText("Range used"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(window.localStorage.getItem("vpt.tips")).toBe("0");
    act(() => {
      fireEvent.pointerOut(screen.getByText("Range used"));
      setTipsEnabled(true);
    });
    rest(screen.getByText("Range used"));
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});

test("labels that appear later are found too", async () => {
  window.localStorage.clear();
  const { rerender } = render(<Page />);
  rerender(<Page more />);
  await waitFor(() => expect(screen.getByText("Volume pace").getAttribute("data-tip")).toMatch(/usual by this time/));
});
