import { DEFAULT_PREFS, applyDesk, applyLook, arrangeViews, fillPrefs, mergePrefs } from "./prefs";

jest.mock("./api", () => ({ api: jest.fn() }));

const VIEWS = [{ id: "analyzer" }, { id: "research" }, { id: "advisor" }, { id: "paper" }];

beforeEach(() => window.localStorage.clear());

test("whatever is at hand becomes a complete set; a change is laid over it part by part", () => {
  expect(fillPrefs(null)).toEqual(DEFAULT_PREFS);
  expect(fillPrefs({ accent: "teal", nav: { order: "nope" }, desk: { dock: "open" } })).toEqual({ ...DEFAULT_PREFS, accent: "teal", desk: { board: true, dock: "open", chart: "pro" } });
  const cur = fillPrefs({ nav: { order: ["paper"], hidden: ["advisor"] }, desk: { chart: "m5" } });
  const next = mergePrefs(cur, { nav: { hidden: [] }, desk: { board: false }, home: { today: false } });
  expect(next.nav).toEqual({ order: ["paper"], hidden: [] });
  expect(next.desk).toEqual({ board: false, dock: "auto", chart: "m5" });
  expect(next.home).toEqual({ status: true, today: false, workspaces: true, market: true, account: true });
});

test("the workspaces come in your order, without the ones you hid — and a preference can only arrange what your role already allows", () => {
  const ids = (p) => arrangeViews(VIEWS, p).map((v) => v.id);
  expect(ids(null)).toEqual(["analyzer", "research", "advisor", "paper"]);
  // the ones you named come first, in your order; the rest keep their built-in order after them
  expect(ids({ nav: { order: ["paper", "analyzer"] } })).toEqual(["paper", "analyzer", "research", "advisor"]);
  expect(ids({ nav: { hidden: ["research", "paper"] } })).toEqual(["analyzer", "advisor"]);
  // the Desk is the way in: it cannot be hidden
  expect(ids({ nav: { hidden: ["analyzer", "advisor"] } })).toEqual(["analyzer", "research", "paper"]);
  // naming a workspace you may not open (it is not in the list given) does not add it
  expect(ids({ nav: { order: ["journal", "account", "paper"] } })).toEqual(["paper", "analyzer", "research", "advisor"]);
});

test("the look goes onto the private area's root; the Desk's start is written where the Desk reads it — at once when you choose it, otherwise only on a device with no choice yet", () => {
  document.body.innerHTML = '<div class="adm"></div>';
  applyLook({ accent: "rose", density: "compact", motion: false, text: "large" });
  const el = document.querySelector(".adm");
  expect([el.getAttribute("data-accent"), el.getAttribute("data-density"), el.getAttribute("data-motion")]).toEqual(["rose", "compact", "off"]);
  expect(document.documentElement.style.fontSize).toBe("106.25%");
  applyLook(null);
  expect(document.documentElement.style.fontSize).toBe("");

  // a device that has chosen keeps its choice…
  window.localStorage.setItem("vpt.desk.chart", "daily");
  applyDesk({ desk: { board: false, dock: "open", chart: "m1" } });
  expect(window.localStorage.getItem("vpt.desk.chart")).toBe("daily");
  expect(window.localStorage.getItem("vpt.desk.board")).toBe("closed");
  expect(window.localStorage.getItem("vpt.terminal.dock")).toBe("open");
  // …until you choose here, now
  applyDesk({ desk: { board: true, dock: "auto", chart: "m1" } }, true);
  expect(window.localStorage.getItem("vpt.desk.chart")).toBe("m1");
  expect(window.localStorage.getItem("vpt.desk.board")).toBe("open");
  expect(window.localStorage.getItem("vpt.terminal.dock")).toBeNull();
});
