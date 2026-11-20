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
  { id: "home", label: "Home" },
  { id: "dharma", label: "Dharma & giving" },
  { id: "food", label: "Food" },
  { id: "other", label: "Other" },
];
const CATEGORIES = [
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
    e("2026-11-03", 1250.5, "grocery", "Vegetables & milk", "cash", "weekly"),
    e("2026-11-03", 640, "dining", "Dinner at Sagar Ratna", "card"),
    e("2026-11-01", 25000, "rent", "November rent"),
    e("2026-10-20", 900, "grocery", "DMart", "card"),
    e("2026-10-12", 1890, "power", "Electricity bill"),
    e("2026-10-01", 25000, "rent", "October rent"),
    e("2025-12-25", 5000, "other", "Miscellaneous"),
  ],
});
const tiles = () => [...document.querySelectorAll(".ex-tile")].map((t) => t.textContent);
const titles = () => [...document.querySelectorAll(".ex-table:not(.ex-table--all) .ex-what b")].map((b) => b.textContent);
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

test("it opens on this month: the figures, the chart, the split and the list all describe the same entries", async () => {
  await show();
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses");
  expect(screen.getByRole("button", { name: "This month" }).getAttribute("aria-pressed")).toBe("true");
  // the figures
  const t = tiles();
  expect(t[0]).toBe("Spent · November 2026₹28,990.504 entries");
  expect(t[1]).toBe("Per day₹1,450over 20 days");
  expect(t[2]).toBe("Biggest groupHome₹25,000 · 86% of the period");
  expect(t[3]).toBe("Biggest single expense₹25,000November rent");
  expect(t[4]).toBe("Against October 2026▲ ₹1,201 more₹27,790 then · +4%");
  // the chart: a bar a day, each one named for a screen reader, the tallest carrying its figure
  expect(screen.getByRole("heading", { name: "Day by day" })).toBeTruthy();
  const bars = [...document.querySelectorAll(".ex-col")];
  expect(bars.length).toBe(30);
  expect(bars[2].getAttribute("aria-label")).toBe("Tuesday, 3 Nov 2026: ₹1,890.50 in 2 entries. Press to open it.");
  expect(bars[1].getAttribute("aria-label")).toBe("Monday, 2 Nov 2026: ₹0. Press to open it.");
  expect(document.querySelector(".ex-col__cap").textContent).toBe("₹25K");
  expect(bars[0].querySelector(".ex-col__bar i").className).toMatch(/ex-g--home/);
  // more than one group is drawn, so a legend names them — in the groups' own order
  expect([...document.querySelectorAll(".ex-chart .ex-legend li")].map((li) => li.textContent)).toEqual(["Home", "Dharma & giving", "Food"]);
  // the split: largest first, in words for a screen reader as well
  expect(document.querySelector(".ex-seg").getAttribute("aria-label")).toBe("The split: Home 86%, Dharma & giving 7%, Food 7%");
  expect([...document.querySelectorAll(".ex-split__row")].map((r) => r.textContent)).toEqual(["Home₹25,00086%", "Dharma & giving₹2,1007%", "Food₹1,890.507%"]);
  // the list: newest day first
  expect(titles()).toEqual(["Rudrabhishek", "Dinner at Sagar Ratna", "Vegetables & milk", "November rent"]);
  const first = document.querySelector(".ex-table tbody tr");
  expect(first.textContent).toMatch(/18 Nov 2026Wednesday.*Rudrabhishek.*Puja & temple.*UPI.*₹2,100/);
  // a name or a figure is never written in a group's colour: the swatch beside it carries it
  expect(first.querySelector(".ex-cat .ex-sw").className).toMatch(/ex-g--dharma/);
});

test("the period can be any month, the year, the last twelve months, all time or picked dates — and the chart's bars change with it", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "The month before" }));
  expect(tiles()[0]).toBe("Spent · October 2026₹27,7903 entries");
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
  expect(titles()).toEqual(["DMart", "Electricity bill", "October rent"]);

  fireEvent.click(screen.getByRole("button", { name: "This year" }));
  expect(tiles()[0]).toBe("Spent · 2026₹56,780.507 entries");
  expect(screen.getByRole("heading", { name: "Month by month" })).toBeTruthy();
  expect(document.querySelectorAll(".ex-col").length).toBe(12);
  // with more than one month in the list, each month is headed by its name and its subtotal
  expect([...document.querySelectorAll(".ex-month")].map((r) => r.textContent)).toEqual(["November 2026₹28,990.50", "October 2026₹27,790"]);
  // pressing a month's bar opens that month
  fireEvent.click(screen.getByRole("button", { name: /^October 2026: ₹27,790 in 3 entries/ }));
  expect(tiles()[0]).toBe("Spent · October 2026₹27,7903 entries");

  fireEvent.click(screen.getByRole("button", { name: "Last 12 months" }));
  expect(tiles()[0]).toBe("Spent · Last 12 months₹61,780.508 entries");
  fireEvent.click(screen.getByRole("button", { name: "All time" }));
  expect(tiles()[0]).toBe("Spent · All time₹61,780.508 entries");
  expect(tiles()[4]).toMatch(/a period of its own: nothing to compare/);
  // picked dates
  fireEvent.click(screen.getByRole("button", { name: /Pick dates/ }));
  expect(tiles()[0]).toBe("Spent · 10 Oct 2026 – 20 Oct 2026₹2,7902 entries");
  expect(screen.getByRole("heading", { name: "Day by day" })).toBeTruthy();
});

test("search, a group, a way of paying and any column's order narrow and arrange the same entries everywhere", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "This year" }));
  fireEvent.change(screen.getByLabelText("Search the entries"), { target: { value: "rent" } });
  expect(titles()).toEqual(["November rent", "October rent"]);
  expect(tiles()[0]).toBe("Spent · 2026 · filtered₹50,0002 entries");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  fireEvent.change(screen.getByLabelText("Group"), { target: { value: "food" } });
  expect(titles()).toEqual(["Dinner at Sagar Ratna", "Vegetables & milk", "DMart"]);
  fireEvent.change(screen.getByLabelText("Paid by", { selector: "#ex-paid" }), { target: { value: "card" } });
  expect(titles()).toEqual(["Dinner at Sagar Ratna", "DMart"]);
  expect(tiles()[0]).toBe("Spent · 2026 · filtered₹1,5402 entries");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

  // a column's heading sorts by it; pressing it again turns it round
  const head = (name) => within(document.querySelector(".ex-table thead")).getByRole("button", { name: new RegExp(`^${name}`) });
  fireEvent.click(head("Amount"));
  expect(titles().slice(0, 3)).toEqual(["November rent", "October rent", "Rudrabhishek"]);
  expect(head("Amount").closest("th").getAttribute("aria-sort")).toBe("descending");
  expect(document.querySelector(".ex-month")).toBeNull(); // month headings only when the list is in day order
  fireEvent.click(head("Amount"));
  expect(titles()[0]).toBe("Dinner at Sagar Ratna");
  expect(head("Amount").closest("th").getAttribute("aria-sort")).toBe("ascending");
  fireEvent.click(head("What"));
  expect(titles()[0]).toBe("Dinner at Sagar Ratna");
  expect(titles()[1]).toBe("DMart");
  fireEvent.change(screen.getByLabelText("Sort the entries"), { target: { value: "date:asc" } });
  expect(titles()[0]).toBe("October rent");

  // a group opens to its categories, and can be made the only one shown
  fireEvent.click(screen.getByRole("button", { name: /^Food/ }));
  expect([...document.querySelectorAll(".ex-split__cats li")].map((li) => li.textContent)).toEqual(["Groceries₹2,150.502 entries", "Eating out₹6401 entry"]);
  fireEvent.click(screen.getByRole("button", { name: "Show only Food" }));
  expect(screen.getByLabelText("Group").value).toBe("food");
  expect(titles().length).toBe(3);
});

test("an expense is added with its day, amount and category; changed in place; removed only after the question", async () => {
  mockApi.mockImplementation((url, opts) => {
    if (opts && opts.method === "POST") return Promise.resolve({ item: { id: "new1", ...opts.body, amount: 480, title: "Auto to the station", createdAt: "2026-11-20T11:00:00.000Z" } });
    if (opts && opts.method === "PUT") return Promise.resolve({ item: { id: url.split("/").pop(), ...opts.body, amount: 2500, createdAt: "2026-11-20T10:00:01.000Z" } });
    if (opts && opts.method === "DELETE") return Promise.resolve({ ok: true });
    return Promise.resolve(ledger());
  });
  await show();
  // the form opens on today
  expect(screen.getByLabelText("Day").value).toBe("2026-11-20");
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "480" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "other" } });
  fireEvent.change(screen.getByLabelText("What it was"), { target: { value: "Auto to the station" } });
  fireEvent.change(screen.getByLabelText("Paid by", { selector: "#ex-method" }), { target: { value: "cash" } });
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitFor(() => expect(screen.getByText("Added: Auto to the station, ₹480 on 20 Nov 2026.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses", { method: "POST", body: { date: "2026-11-20", amount: "480", category: "other", title: "Auto to the station", method: "cash", note: "" } });
  // it is in the list and in every figure at once; the day, category and way of paying stay for the next one
  expect(titles()[0]).toBe("Auto to the station");
  expect(tiles()[0]).toBe("Spent · November 2026₹29,470.505 entries");
  expect([screen.getByLabelText("Amount (₹)").value, screen.getByLabelText("What it was").value, screen.getByLabelText("Day").value, screen.getByLabelText("Category").value]).toEqual(["", "", "2026-11-20", "other"]);

  // change one: it is put into the form, and saved under its own id
  fireEvent.click(screen.getByRole("button", { name: "Change Rudrabhishek, ₹2,100" }));
  expect(screen.getByRole("heading", { name: "Change this expense" })).toBeTruthy();
  expect([screen.getByLabelText("Amount (₹)").value, screen.getByLabelText("Day").value, screen.getByLabelText("Category").value]).toEqual(["2100", "2026-11-18", "puja"]);
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "2500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save the change" }));
  await waitFor(() => expect(screen.getByText("Changed: Rudrabhishek, ₹2,500 on 18 Nov 2026.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses/e1", { method: "PUT", body: { date: "2026-11-18", amount: "2500", category: "puja", title: "Rudrabhishek", method: "upi", note: "" } });
  expect(tiles()[0]).toBe("Spent · November 2026₹29,870.505 entries");
  expect(screen.getByRole("heading", { name: "Add an expense" })).toBeTruthy();

  // remove: asked first, in words; "keep it" changes nothing
  mockAsk.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Remove November rent, ₹25,000" }));
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
  expect(mockAsk.mock.calls[0][0].title).toBe("Remove this expense?");
  expect(mockApi.mock.calls.some((c) => c[1] && c[1].method === "DELETE")).toBe(false);
  mockAsk.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove November rent, ₹25,000" }));
  await waitFor(() => expect(screen.getByText("Removed: November rent, ₹25,000.")).toBeTruthy());
  expect(mockApi).toHaveBeenCalledWith("/api/admin/expenses/e4", { method: "DELETE" });
  expect(tiles()[0]).toBe("Spent · November 2026₹4,870.504 entries");
});

test("what the server refuses is shown in its own words, and nothing is added", async () => {
  mockApi.mockImplementation((url, opts) => (opts && opts.method === "POST" ? Promise.reject(new Error("Enter the amount, above zero.")) : Promise.resolve(ledger())));
  await show();
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Enter the amount, above zero."));
  expect(tiles()[0]).toBe("Spent · November 2026₹28,990.504 entries");
});

test("the whole ledger month by month and year by year; a row opens that month or year", async () => {
  await show();
  const all = () => [...document.querySelectorAll(".ex-table--all tbody tr")].map((r) => r.textContent);
  expect(screen.getByRole("heading", { name: "Every month" })).toBeTruthy();
  expect(all()).toEqual(["November 2026₹28,990.504₹1,450Home · 86%", "October 2026₹27,7903₹896Home · 97%", "December 2025₹5,0001₹161Other · 100%"]);
  expect(document.querySelector(".ex-table--all tr.is-on").textContent).toMatch(/^November 2026/);
  expect(document.querySelector(".ex-table--all .ex-seg--row").getAttribute("aria-label")).toBe("Home 86%, Dharma & giving 7%, Food 7%");
  fireEvent.click(screen.getByRole("button", { name: "December 2025" }));
  expect(tiles()[0]).toBe("Spent · December 2025₹5,0001 entry");

  fireEvent.click(screen.getByRole("button", { name: "Year by year" }));
  expect(screen.getByRole("heading", { name: "Every year" })).toBeTruthy();
  expect(all()).toEqual(["2026₹56,780.507₹175Home · 91%", "2025₹5,0001₹14Other · 100%"]);
  fireEvent.click(screen.getByRole("button", { name: "2026" }));
  expect(tiles()[0]).toBe("Spent · 2026₹56,780.507 entries");
  // the legend under the table names every group
  expect([...document.querySelectorAll(".ex-card:last-of-type .ex-legend li")].map((li) => li.textContent)).toEqual(["Home", "Dharma & giving", "Food", "Other"]);
});

test("an empty ledger says how to begin; a ledger that cannot be read says why", async () => {
  mockApi.mockImplementation(() => Promise.resolve({ ...ledger(), items: [] }));
  const first = render(<Expenses />);
  await waitFor(() => expect(screen.getByText(/No expense has been entered yet/)).toBeTruthy());
  expect(tiles()[0]).toBe("Spent · November 2026₹00 entries");
  expect(screen.getAllByText("Nothing was spent in this period.").length).toBe(2);
  expect(screen.getByRole("button", { name: /Export/ }).disabled).toBe(true);
  first.unmount();

  mockApi.mockImplementation(() => Promise.reject(new Error("Only the superadmin can do this.")));
  render(<Expenses />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Only the superadmin can do this."));
});
