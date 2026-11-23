import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Vinaypedia, { matches } from "./Vinaypedia";
import { api } from "../../api";
import { snack } from "../../ux/snack";

jest.mock("../../api", () => ({ api: jest.fn() }));
// the real helper only runs on its timer and on live changes: the page must make its first read itself
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("../../ux/snack", () => ({ snack: jest.fn() }));

// made-up content, nobody's account
const DATA = {
  at: "2026-11-23T10:00:00Z",
  areas: [
    { name: "Indicators", pages: 2, notes: 1, updates: 0, lesson: true, reading: ["varsity-ta"] },
    { name: "Options and derivatives", pages: 1, notes: 0, updates: 1, lesson: false, reading: ["varsity-options"] },
    { name: "My own", pages: 0, notes: 1, updates: 0, lesson: false, reading: [] },
  ],
  library: [
    { id: "ind-vwap", area: "Indicators", title: "VWAP", rules: ["VWAP is the volume-weighted average price.", "Above it buyers lead.", "Institutions benchmark to it."], keys: "vwap average" },
    { id: "ind-rsi", area: "Indicators", title: "RSI", rules: ["RSI measures momentum."], keys: "rsi momentum" },
    { id: "opt-oi", area: "Options and derivatives", title: "Open interest", rules: ["OI counts open contracts."], keys: "oi open interest" },
  ],
  notes: [
    { id: "aaa111", title: "VWAP is my anchor", body: "Only longs above VWAP.", area: "Indicators", kind: "rule", tags: ["vwap"], link: "", pinned: true, by: "me@example.com", name: "Me", createdAt: "2026-11-20T10:00:00Z", updatedAt: null, mine: true },
    { id: "bbb222", title: "Someone else's idea", body: "Try the 5-minute ORB.", area: "My own", kind: "idea", tags: [], link: "", pinned: false, by: "x@example.com", name: "X", createdAt: "2026-11-21T10:00:00Z", updatedAt: null, mine: false },
  ],
  kinds: ["lesson", "rule", "mistake", "idea"],
  updates: [
    { key: "nse:1", source: "nse", by: "NSE", kind: "rules", title: "Revision in lot sizes of derivative contracts", link: "https://nsearchives.nseindia.com/c/1.pdf", at: "2026-11-23T04:30:00Z", text: "", areas: ["Options and derivatives"], intraday: true },
    { key: "varsity:2", source: "varsity", by: "Zerodha", kind: "lessons", title: "How to check your EPF balance", link: "https://zerodha.com/varsity/b", at: "2026-11-22T04:30:00Z", text: "", areas: ["Investing and portfolio"], intraday: false },
  ],
  lessons: { Indicators: { area: "Indicators", at: "2026-11-22T10:00:00Z", model: "test-model", summary: "Indicators summarise price and volume.", points: ["VWAP anchors the day."], rules: ["Trade with VWAP's side."], mistakes: ["Stacking indicators that say the same thing."], example: "Illustration: ₹500 stock above VWAP.", checklist: ["Which side of VWAP?"], read: ["varsity-ta"], caveat: "Confirm on the chart.", grounded: { pages: 2, updates: 0, notes: 1 } } },
  digest: null,
  reading: [
    { id: "varsity-ta", name: "Zerodha Varsity — Technical Analysis", url: "https://zerodha.com/varsity/module/technical-analysis/" },
    { id: "varsity-options", name: "Zerodha Varsity — Option Theory", url: "https://zerodha.com/varsity/module/option-theory/" },
  ],
  sources: [{ id: "nse", name: "NSE circulars", by: "NSE", home: "https://www.nseindia.com/resources/exchange-communication-circulars", kind: "rules", lastAttemptAt: "2026-11-23T05:00:00Z", lastSuccessAt: "2026-11-23T05:00:00Z", lastError: "", count: 19 }],
  updatesKept: 2,
  ai: { configured: true, busy: [] },
};

const route = (over = {}) =>
  api.mockImplementation(async (url, opts = {}) => {
    if (over[`${opts.method || "GET"} ${url}`]) return over[`${opts.method || "GET"} ${url}`](opts);
    if (url === "/api/admin/learning") return DATA;
    return {};
  });

test("search: every word must appear somewhere", () => {
  expect(matches("vwap anchor", "VWAP is my anchor")).toBe(true);
  expect(matches("vwap expiry", "VWAP is my anchor")).toBe(false);
  expect(matches("", "anything")).toBe(true);
  expect(matches("oi", ["Open", "interest"], "oi open")).toBe(true);
});

test("the head, the rail of areas, what's new (intraday only) and the library by area", async () => {
  route();
  const { container } = render(<Vinaypedia />);
  expect(await screen.findByRole("heading", { name: /Vinaypedia/, level: 2 })).toBeTruthy();
  expect(container.querySelector(".vp-stats").textContent).toMatch(/3 library pages in 2 areas.*1 official updates.*1 AI lesson.*2 learnings of yours/);
  const rail = screen.getByRole("navigation", { name: "Areas" });
  expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual(["All areas5", "Indicators3", "Options and derivatives1", "My own1"]);
  // what's new: the personal-finance item is tucked away
  expect(screen.getByRole("link", { name: /Revision in lot sizes/ })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /EPF balance/ })).toBeNull();
  // my learnings: pinned first, edit only on my own
  const notes = [...container.querySelectorAll(".vp-note")];
  expect(notes[0].textContent).toMatch(/Rule I follow.*Pinned.*VWAP is my anchor/);
  expect(within(notes[0]).getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(within(notes[1]).queryByRole("button", { name: "Edit" })).toBeNull();
  // the library, as area cards
  expect([...container.querySelectorAll(".vp-areacard")].map((b) => b.textContent)).toEqual(["Indicators2 pages · 1 yours · AI lesson", "Options and derivatives1 page · 1 update"]);
});

test("an area opens its learnings, AI lesson, official reading and library pages; search narrows everything", async () => {
  route();
  const { container } = render(<Vinaypedia />);
  await screen.findByRole("heading", { name: /Vinaypedia/, level: 2 });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", { name: /^Indicators/ }));
  expect(screen.getByRole("heading", { name: "Indicators", level: 3 })).toBeTruthy();
  // the area's official reading, and the lesson's "read next" (only from the official list)
  const ta = screen.getAllByRole("link", { name: /Zerodha Varsity — Technical Analysis/ });
  expect(ta).toHaveLength(2);
  for (const l of ta) expect(l.getAttribute("href")).toBe("https://zerodha.com/varsity/module/technical-analysis/");
  expect(container.querySelector(".vp-lesson__sum").textContent).toBe("Indicators summarise price and volume.");
  expect(screen.getByRole("button", { name: "Rewrite with AI" })).toBeTruthy();
  // a library page shows two points and opens for the rest
  const vwap = screen.getByRole("button", { name: /^VWAP\s*3 points/ });
  expect(vwap.closest(".vp-page").querySelectorAll("li")).toHaveLength(2);
  fireEvent.click(vwap);
  expect(vwap.closest(".vp-page").querySelectorAll("li")).toHaveLength(3);
  // search
  fireEvent.change(screen.getByRole("searchbox", { name: "Search Vinaypedia" }), { target: { value: "rsi" } });
  expect(screen.queryByRole("button", { name: /^VWAP\s*3 points/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^RSI\s*1 points/ })).toBeTruthy();
  expect(screen.getByText("None of your learnings match the search.")).toBeTruthy();
});

test("the AI writes a lesson only on a press, and a failure is said plainly", async () => {
  let posted = null;
  route({
    "POST /api/admin/learning/lessons": async (opts) => {
      posted = opts.body;
      throw new Error("Add an AI model on the AI page first.");
    },
  });
  render(<Vinaypedia />);
  await screen.findByRole("heading", { name: /Vinaypedia/, level: 2 });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", { name: /^Options and derivatives/ }));
  expect(screen.getByText(/No lesson yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Write with AI" }));
  await waitFor(() => expect(posted).toEqual({ area: "Options and derivatives" }));
  await waitFor(() => expect(snack).toHaveBeenCalledWith("Add an AI model on the AI page first.", { tone: "error" }));
});

test("add my learning: the form files it under the open area, sends it, and closes", async () => {
  let sent = null;
  route({
    "POST /api/admin/learning/notes": async (opts) => {
      sent = opts.body;
      return { note: { id: "ccc333", ...opts.body } };
    },
  });
  render(<Vinaypedia />);
  await screen.findByRole("heading", { name: /Vinaypedia/, level: 2 });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Areas" })).getByRole("button", { name: /^Options and derivatives/ }));
  fireEvent.click(screen.getByRole("button", { name: "+ Add my learning" }));
  const dlg = screen.getByRole("dialog", { name: "Add my learning" });
  expect(within(dlg).getByRole("combobox").value).toBe("Options and derivatives");
  fireEvent.change(within(dlg).getByRole("textbox", { name: "Title" }), { target: { value: "Recheck size after a lot change" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Mistake to avoid" }));
  fireEvent.change(within(dlg).getByRole("textbox", { name: /What I learnt/ }), { target: { value: "I sized for the old lot." } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Add learning" }));
  await waitFor(() => expect(sent).toMatchObject({ title: "Recheck size after a lot change", kind: "mistake", area: "Options and derivatives", body: "I sized for the old lot.", pinned: false }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(snack).toHaveBeenCalledWith("Learning added.", { tone: "ok" });
});

test("delete asks once more before it removes", async () => {
  let removed = "";
  route({
    "DELETE /api/admin/learning/notes/aaa111": async () => {
      removed = "aaa111";
      return { removed: true };
    },
  });
  render(<Vinaypedia />);
  await screen.findByRole("heading", { name: /Vinaypedia/, level: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(removed).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Sure? Delete" }));
  await waitFor(() => expect(removed).toBe("aaa111"));
});
