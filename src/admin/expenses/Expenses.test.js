import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Expenses from "./Expenses";

const mockApi = jest.fn();
const mockAsk = jest.fn();
jest.mock("../api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("../dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));
jest.mock("../Shell", () => ({ __esModule: true, default: ({ children }) => <div className="adm">{children}</div> }));
// the calendar is its own component with its own tests: here a plain field stands in for it
jest.mock("../DatePicker", () => ({
  DateField: ({ value, onChange, label, id }) => (
    <label>
      {label}
      <input id={id} aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
  DateRangeField: ({ value, onChange, label }) => (
    <button type="button" onClick={() => onChange({ from: "2026-10-10", to: "2026-10-20" })}>
      {label}: {value ? `${value.from} – ${value.to}` : "none"}
    </button>
  ),
}));

const GROUPS = [
  { id: "stock", label: "Stock Market" },
  { id: "home", label: "Home" },
  { id: "dharma", label: "Dharma & giving" },
  { id: "food", label: "Food" },
  { id: "other", label: "Other" },
];
const CATEGORIES = [
  { id: "kiteapi", label: "Zerodha Kite API subscription", group: "stock" },
  { id: "chatgpt", label: "ChatGPT subscription", group: "stock" },
  { id: "rent", label: "Rent", group: "home" },
  { id: "power", label: "Electricity, water & gas", group: "home" },
  { id: "puja", label: "Puja & temple", group: "dharma" },
  { id: "grocery", label: "Groceries", group: "food" },
  { id: "dining", label: "Eating out", group: "food" },
  { id: "other", label: "Other", group: "other" },
];
const METHODS = [{ id: "upi", label: "UPI" }, { id: "cash", label: "Cash" }, { id: "card", label: "Card" }];
let n = 0;
const e = (date, amount, category, title, method = "upi", note = "") => ({ id: `e${(n += 1)}`, date, amount, category, title, method, note, createdAt: `2026-11-20T10:00:${String(n).padStart(2, "0")}.000Z` });
// a made-up ledger: nobody's real spending
const ledger = () => ({
  today: "2026-11-20",
  groups: GROUPS,
  categories: CATEGORIES,
  methods: METHODS,
  items: [
    e("2026-11-18", 2100, "puja", "Rudrabhishek"),
    e("2026-11-04", 500, "kiteapi", "Kite Connect"),
    e("2026-11-03", 1250.5, "grocery", "Vegetables & milk", "cash", "weekly"),
    e("2026-11-03", 640, "dining", "Dinner at Sagar Ratna", "card"),
    e("2026-11-02", 1999, "chatgpt", "ChatGPT Plus", "card"),
    e("2026-11-01", 25000, "rent", "November rent"),
    e("2026-10-20", 900, "grocery", "DMart", "card"),
    e("2026-10-12", 1890, "power", "Electricity bill"),
    e("2026-10-02", 1999, "chatgpt", "ChatGPT Plus", "card"),
    e("2026-10-01", 25000, "rent", "October rent"),
    e("2025-12-25", 5000, "other", "Miscellaneous"),
  ],
});
const scores = () => [...document.querySelectorAll(".ex-score")].map((t) => t.textContent);
const spentNow = () => document.querySelector(".ex-score--lead .ex-score__v").textContent;
const titles = () => [...document.querySelectorAll(".ex-table:not(.ex-table--all) .ex-what b")].map((b) => b.textContent);
const card = (heading) => screen.getByRole("heading", { name: heading }).closest("section");
const show = async () => {
  render(<Expenses />);
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Expenses" })).toBeTruthy());
};

beforeEach(() => {
  n = 0;
  mockApi.mockReset();
  mockAsk.mockReset();
  mockApi.mockImplementation(() => Promise.resolve(ledger()));
});

test("it opens on this month, laid out like an analytics report: scorecards with the change and a sparkline, the trend, the donut, the rankings", async () => {
  await show();
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses");
  expect(screen.getByRole("button", { name: "This month" }).getAttribute("aria-pressed")).toBe("true");
  // the scorecards: spending more than the period before is marked ▲ (the red way), in words as well as colour
  expect(scores()).toEqual([
    "Spent · November 2026₹31,489.50▲ +6%₹29,789 in October 2026",
    "Per day₹1,574▲ +64%over 20 days",
    "Entries6▲ +50%₹5,248 each, on average",
    "Stock Market costs₹2,499▲ +25%8% of all spending",
    "Biggest expense₹25,000November rent · 1 Nov 2026",
  ]);
  expect(document.querySelector(".ex-score--lead .ex-delta").className).toMatch(/is-more/);
  expect(document.querySelectorAll(".ex-score .ex-spark[role='img']").length).toBe(3);

  // the trend: a line a day, the period before dashed beside it; every point is named for a screen reader
  const trend = card("Spending over time");
  expect(within(trend).getByRole("tab", { name: "Total" }).getAttribute("aria-selected")).toBe("true");
  const points = trend.querySelectorAll(".ex-line__hits button");
  expect(points.length).toBe(30);
  expect(points[0].getAttribute("aria-label")).toBe("Sunday, 1 Nov 2026: ₹25,000, ₹25,000 in the period before. Press to open it.");
  expect(points[2].getAttribute("aria-label")).toBe("Tuesday, 3 Nov 2026: ₹1,890.50, ₹0 in the period before. Press to open it.");
  expect([...trend.querySelectorAll(".ex-legend li")].map((li) => li.textContent)).toEqual(["This period", "October 2026"]);
  expect(trend.querySelector(".ex-line__prev")).toBeTruthy();
  // hovering a day shows both lines' figures
  fireEvent.pointerEnter(points[0]);
  expect(trend.querySelector(".ex-tip").textContent).toMatch(/Sunday, 1 Nov 2026₹25,000 spent · 1 entry₹25,000 october 2026/);

  // the donut: every group's figure is in its legend, largest first; the ring says the same in words
  const split = card("Where it went");
  expect(split.querySelector("svg").getAttribute("aria-label")).toBe("Where it went: Home 79%, Stock Market 8%, Dharma & giving 7%, Food 6%");
  expect([...split.querySelectorAll(".ex-donut__legend button")].map((b) => b.textContent)).toEqual(["Home₹25,00079%", "Stock Market₹2,4998%", "Dharma & giving₹2,1007%", "Food₹1,890.506%"]);
  expect(split.querySelector(".ex-donut__mid").textContent).toBe("Total₹31.5K4 groups");

  // the rankings
  expect([...card("Top categories").querySelectorAll(".ex-rank__row")].map((r) => r.textContent)).toEqual(["Rent₹25,00079%", "Puja & temple₹2,1007%", "ChatGPT subscription₹1,9996%", "Groceries₹1,250.504%", "Eating out₹6402%", "Zerodha Kite API subscription₹5002%"]);
  const stock = card(/Stock Market costs/);
  expect(stock.querySelector(".ex-mini").textContent).toBe("₹2,499about ₹2,499 a month");
  // a share of what the trading desk cost, not of all spending
  expect([...stock.querySelectorAll(".ex-rank__row")].map((r) => r.textContent)).toEqual(["ChatGPT subscription₹1,99980%", "Zerodha Kite API subscription₹50020%"]);
  expect([...card("By day of the week").querySelectorAll(".ex-colset__c")].map((c) => c.getAttribute("aria-label"))).toEqual(["Monday: ₹1,999 in 1 entry", "Tuesday: ₹1,890.50 in 2 entries", "Wednesday: ₹2,600 in 2 entries", "Thursday: ₹0 in 0 entries", "Friday: ₹0 in 0 entries", "Saturday: ₹0 in 0 entries", "Sunday: ₹25,000 in 1 entry"]);
  expect([...card("Paid by").querySelectorAll(".ex-rank__row")].map((r) => r.textContent)).toEqual(["UPI₹27,60088%", "Card₹2,6398%", "Cash₹1,250.504%"]);

  // the list: newest day first, a swatch beside the category (a name is never written in a group's colour)
  expect(titles()).toEqual(["Rudrabhishek", "Kite Connect", "Dinner at Sagar Ratna", "Vegetables & milk", "ChatGPT Plus", "November rent"]);
  expect(document.querySelector(".ex-table tbody tr .ex-cat .ex-sw").className).toMatch(/ex-g--dharma/);
});

test("“compare” can be switched off: no change chips, no dashed line", async () => {
  await show();
  fireEvent.click(screen.getByRole("checkbox", { name: /Compare with October 2026/ }));
  expect(document.querySelector(".ex-delta")).toBeNull();
  expect(scores()[0]).toBe("Spent · November 2026₹31,489.506 entries");
  const trend = card("Spending over time");
  expect(trend.querySelector(".ex-line__prev")).toBeNull();
  expect([...trend.querySelectorAll(".ex-legend li")].map((li) => li.textContent)).toEqual(["This period"]);
});

test("the period can be any month, the year, the last twelve months, all time or picked dates; bars by group open their month", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "The month before" }));
  expect(spentNow()).toBe("₹29,789");
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
  expect(titles()).toEqual(["DMart", "Electricity bill", "ChatGPT Plus", "October rent"]);

  fireEvent.click(screen.getByRole("button", { name: "This year" }));
  expect(scores()[0]).toBe("Spent · 2026₹61,278.50▲ more than 10 times as much₹5,000 in 2025");
  expect(screen.getByText(/2026 · month by month/)).toBeTruthy();
  // by group: a bar a month, stacked; a bar opens its month
  fireEvent.click(screen.getByRole("tab", { name: "By group" }));
  expect(document.querySelectorAll(".ex-col").length).toBe(12);
  expect([...document.querySelectorAll(".ex-chart .ex-legend li")].map((li) => li.textContent)).toEqual(["Stock Market", "Home", "Dharma & giving", "Food"]);
  fireEvent.click(screen.getByRole("button", { name: /^October 2026: ₹29,789 in 4 entries/ }));
  expect(spentNow()).toBe("₹29,789");
  expect([...document.querySelectorAll(".ex-month")].length).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "Last 12 months" }));
  // nothing was entered in the twelve months before, so there is no change to show: the count instead
  expect(scores()[0]).toBe("Spent · Last 12 months₹66,278.5011 entries");
  fireEvent.click(screen.getByRole("button", { name: "All time" }));
  expect(scores()[0]).toBe("Spent · All time₹66,278.5011 entries");
  // picked dates
  fireEvent.click(screen.getByRole("button", { name: /Pick dates/ }));
  expect(scores()[0]).toBe("Spent · 10 Oct 2026 – 20 Oct 2026₹2,7902 entries");
});

test("search, a group, a way of paying and any column's order narrow and arrange the same entries; the donut selects a group", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "This year" }));
  fireEvent.change(screen.getByLabelText("Search the entries"), { target: { value: "rent" } });
  expect(titles()).toEqual(["November rent", "October rent"]);
  expect(spentNow()).toBe("₹50,000");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  fireEvent.change(screen.getByLabelText("Group"), { target: { value: "food" } });
  expect(titles()).toEqual(["Dinner at Sagar Ratna", "Vegetables & milk", "DMart"]);
  fireEvent.change(screen.getByLabelText("Paid by", { selector: "#ex-paid" }), { target: { value: "card" } });
  expect(titles()).toEqual(["Dinner at Sagar Ratna", "DMart"]);
  expect(spentNow()).toBe("₹1,540");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  // pressing a group in the donut's legend shows only that group, the others greyed; pressing it again clears
  const split = card("Where it went");
  fireEvent.click(within(split).getByRole("button", { name: /^Stock Market/ }));
  expect(screen.getByLabelText("Group").value).toBe("stock");
  expect(titles()).toEqual(["Kite Connect", "ChatGPT Plus", "ChatGPT Plus"]);
  expect(split.querySelector(".ex-donut__legend li.is-on").textContent).toMatch(/^Stock Market/);
  expect(split.querySelectorAll(".ex-donut__legend li.is-dim").length).toBe(3);
  // the donut keeps every group in view, so the share stays readable
  expect(split.querySelector(".ex-donut__mid").textContent).toMatch(/^Stock Market₹4.5K7%/);
  fireEvent.click(within(split).getByRole("button", { name: /^Stock Market/ }));
  expect(screen.getByLabelText("Group").value).toBe("");

  // a category in the ranking searches for it
  fireEvent.click(within(card("Top categories")).getByRole("button", { name: /^Groceries/ }));
  expect(screen.getByLabelText("Search the entries").value).toBe("Groceries");
  expect(titles()).toEqual(["Vegetables & milk", "DMart"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  // a column's heading sorts by it; pressing it again turns it round
  const head = (name) => within(document.querySelector(".ex-table thead")).getByRole("button", { name: new RegExp(`^${name}`) });
  fireEvent.click(head("Amount"));
  expect(titles().slice(0, 2)).toEqual(["November rent", "October rent"]);
  expect(head("Amount").closest("th").getAttribute("aria-sort")).toBe("descending");
  fireEvent.click(head("Amount"));
  expect(titles()[0]).toBe("Kite Connect");
});

test("an expense is added with its day, amount and category — Stock Market ones too; changed in place; removed only after the question", async () => {
  mockApi.mockImplementation((url, opts) => {
    if (opts && opts.method === "POST") return Promise.resolve({ item: { id: "new1", ...opts.body, amount: 1700, title: "Claude Pro", createdAt: "2026-11-20T11:00:00.000Z" } });
    if (opts && opts.method === "PUT") return Promise.resolve({ item: { id: url.split("/").pop(), ...opts.body, amount: 2500, createdAt: "2026-11-20T10:00:01.000Z" } });
    if (opts && opts.method === "DELETE") return Promise.resolve({ ok: true });
    return Promise.resolve(ledger());
  });
  await show();
  // the categories are listed under their groups, Stock Market first
  expect([...screen.getByLabelText("Category").querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Stock Market", "Home", "Dharma & giving", "Food", "Other"]);
  expect(screen.getByLabelText("Day").value).toBe("2026-11-20");
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1700" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "chatgpt" } });
  fireEvent.change(screen.getByLabelText("What it was"), { target: { value: "Claude Pro" } });
  fireEvent.change(screen.getByLabelText("Paid by", { selector: "#ex-method" }), { target: { value: "card" } });
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitFor(() => expect(screen.getByText("Added: Claude Pro, ₹1,700 on 20 Nov 2026.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses", { method: "POST", body: { date: "2026-11-20", amount: "1700", category: "chatgpt", title: "Claude Pro", method: "card", note: "" } });
  expect(titles()[0]).toBe("Claude Pro");
  expect(spentNow()).toBe("₹33,189.50");
  expect(scores()[3]).toMatch(/^Stock Market costs₹4,199/);
  expect([screen.getByLabelText("Amount (₹)").value, screen.getByLabelText("Category").value]).toEqual(["", "chatgpt"]);

  fireEvent.click(screen.getByRole("button", { name: "Change Rudrabhishek, ₹2,100" }));
  expect(screen.getByRole("heading", { name: "Change this expense" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "2500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save the change" }));
  await waitFor(() => expect(screen.getByText("Changed: Rudrabhishek, ₹2,500 on 18 Nov 2026.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses/e1", { method: "PUT", body: { date: "2026-11-18", amount: "2500", category: "puja", title: "Rudrabhishek", method: "upi", note: "" } });
  expect(spentNow()).toBe("₹33,589.50");

  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Remove November rent, ₹25,000" }));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(mockAsk.mock.calls[0][0].title).toBe("Remove this expense?");
  expect(mockApi.mock.calls.some((c) => c[1] && c[1].method === "DELETE")).toBe(false);
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove November rent, ₹25,000" }));
  await waitFor(() => expect(screen.getByText("Removed: November rent, ₹25,000.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses/e6", { method: "DELETE" });
  expect(spentNow()).toBe("₹8,589.50");
  expect(document.querySelector(".ex-score--lead .ex-delta").className).toMatch(/is-less/);
}, 30000); // a long typing test: given room when the whole suite runs at once

test("what the server refuses is shown in its own words, and nothing is added", async () => {
  mockApi.mockImplementation((url, opts) => (opts && opts.method === "POST" ? Promise.reject(new Error("Enter the amount, above zero.")) : Promise.resolve(ledger())));
  await show();
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Enter the amount, above zero."));
  expect(spentNow()).toBe("₹31,489.50");
});

test("the whole ledger month by month and year by year; a row opens that month or year", async () => {
  await show();
  const all = () => [...document.querySelectorAll(".ex-table--all tbody tr")].map((r) => r.textContent);
  expect(screen.getByRole("heading", { name: "Every month" })).toBeTruthy();
  expect(all()).toEqual(["November 2026₹31,489.506₹1,574Home · 79%", "October 2026₹29,7894₹961Home · 90%", "December 2025₹5,0001₹161Other · 100%"]);
  fireEvent.click(screen.getByRole("button", { name: "December 2025" }));
  expect(scores()[0]).toBe("Spent · December 2025₹5,0001 entry");
  fireEvent.click(screen.getByRole("button", { name: "Year by year" }));
  expect(all()).toEqual(["2026₹61,278.5010₹189Home · 85%", "2025₹5,0001₹14Other · 100%"]);
  fireEvent.click(screen.getByRole("button", { name: "2026" }));
  expect(spentNow()).toBe("₹61,278.50");
});

test("an empty ledger says how to begin; a ledger that cannot be read says why", async () => {
  mockApi.mockImplementation(() => Promise.resolve({ ...ledger(), items: [] }));
  const first = render(<Expenses />);
  await waitFor(() => expect(screen.getByText(/No expense has been entered yet/)).toBeTruthy());
  expect(scores()[0]).toBe("Spent · November 2026₹00 entries");
  expect(screen.getAllByText("Nothing was spent in this period.").length).toBe(5);
  expect(screen.getByText(/No Stock Market cost in this period/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Export/ }).disabled).toBe(true);
  first.unmount();

  mockApi.mockImplementation(() => Promise.reject(new Error("Only the superadmin can do this.")));
  render(<Expenses />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Only the superadmin can do this."));
});
