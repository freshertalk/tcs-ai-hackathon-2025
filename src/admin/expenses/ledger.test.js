import { addMonths, applyFilters, breakdown, bucketsFor, compact, dayName, daysSoFar, lastDay, money, monthName, niceScale, periodRange, sortItems, splitByGroup, stack, toCsv, total, within } from "./ledger";

const GROUPS = [
  { id: "home", label: "Home" },
  { id: "dharma", label: "Dharma & giving" },
  { id: "food", label: "Food" },
  { id: "other", label: "Other" },
];
const CATS = new Map(
  [
    { id: "rent", label: "Rent", group: "home" },
    { id: "power", label: "Electricity, water & gas", group: "home" },
    { id: "puja", label: "Puja & temple", group: "dharma" },
    { id: "grocery", label: "Groceries", group: "food" },
    { id: "dining", label: "Eating out", group: "food" },
    { id: "other", label: "Other", group: "other" },
  ].map((c) => [c.id, c])
);
const METHODS = [{ id: "upi", label: "UPI" }, { id: "cash", label: "Cash" }, { id: "card", label: "Card" }];
let n = 0;
const e = (date, amount, category, title, method = "upi", note = "") => ({ id: `e${(n += 1)}`, date, amount, category, title, method, note, createdAt: `2026-11-20T10:00:${String(n).padStart(2, "0")}.000Z` });
const ITEMS = [
  e("2026-11-01", 25000, "rent", "November rent", "netbanking"),
  e("2026-11-03", 1250.5, "grocery", "Vegetables & milk", "cash", "weekly"),
  e("2026-11-03", 640, "dining", "Dinner at Sagar Ratna", "card"),
  e("2026-11-18", 2100, "puja", "Rudrabhishek"),
  e("2026-10-01", 25000, "rent", "October rent", "netbanking"),
  e("2026-10-12", 1890, "power", "Electricity bill"),
  e("2026-10-20", 900, "grocery", "DMart", "card"),
  e("2025-12-25", 5000, "other", "Miscellaneous"),
];
const TODAY = "2026-11-20";

test("money is written the Indian way; a short figure uses thousand, lakh and crore", () => {
  expect([money(125000), money(1250.5), money(0), money(99.999)]).toEqual(["₹1,25,000", "₹1,250.50", "₹0", "₹100"]);
  expect([compact(950), compact(12500), compact(120000), compact(34000000), compact(1000), compact(0)]).toEqual(["₹950", "₹12.5K", "₹1.2L", "₹3.4Cr", "₹1K", "₹0"]);
});

test("months and days: names, month ends and stepping across a year", () => {
  expect([monthName("2026-11"), dayName("2026-11-03"), lastDay("2026-02"), lastDay("2028-02"), lastDay("2026-11")]).toEqual(["November 2026", "3 Nov 2026", 28, 29, 30]);
  expect([addMonths("2026-11", 1), addMonths("2026-12", 1), addMonths("2026-01", -1), addMonths("2026-11", -11)]).toEqual(["2026-12", "2027-01", "2025-12", "2025-12"]);
});

test("a period has its days, its name and the period before it to compare with", () => {
  expect(periodRange({ kind: "month", ym: "2026-11" }, TODAY)).toEqual({ kind: "month", ym: "2026-11", from: "2026-11-01", to: "2026-11-30", label: "November 2026", prev: { from: "2026-10-01", to: "2026-10-31", label: "October 2026" } });
  // with nothing chosen it is this month
  expect(periodRange(null, TODAY).label).toBe("November 2026");
  expect(periodRange({ kind: "year", y: 2026 }, TODAY)).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "2026", prev: { from: "2025-01-01", to: "2025-12-31", label: "2025" } });
  expect(periodRange({ kind: "last12" }, TODAY)).toMatchObject({ from: "2025-12-01", to: "2026-11-30", label: "Last 12 months", prev: { from: "2024-12-01", to: "2025-11-30" } });
  // all time runs from the first entry to the last (or today)
  expect(periodRange({ kind: "all" }, TODAY, ITEMS)).toMatchObject({ from: "2025-12-25", to: "2026-11-20", label: "All time", prev: null });
  // a range picked back to front is put the right way round
  expect(periodRange({ kind: "range", from: "2026-11-10", to: "2026-11-01" }, TODAY)).toMatchObject({ from: "2026-11-01", to: "2026-11-10", label: "1 Nov 2026 – 10 Nov 2026" });
  expect(within(ITEMS, periodRange({ kind: "month", ym: "2026-10" }, TODAY)).map((x) => x.title)).toEqual(["October rent", "Electricity bill", "DMart"]);
  // "per day" is divided by the days that have gone by: 20 of this November, all 31 of October
  expect([daysSoFar(periodRange({ kind: "month", ym: "2026-11" }, TODAY), TODAY), daysSoFar(periodRange({ kind: "month", ym: "2026-10" }, TODAY), TODAY), daysSoFar(periodRange({ kind: "month", ym: "2026-12" }, TODAY), TODAY)]).toEqual([20, 31, 1]);
});

test("search looks in what it was, the note, the category, the way of paying, the day and the amount; group and method narrow it", () => {
  const range = periodRange({ kind: "year", y: 2026 }, TODAY);
  const find = (f) => applyFilters(ITEMS, { range, ...f }, CATS).map((x) => x.title);
  expect(find({}).length).toBe(7);
  expect(find({ q: "rent" })).toEqual(["November rent", "October rent"]);
  expect(find({ q: "RENT nov" })).toEqual(["November rent"]);
  expect(find({ q: "weekly" })).toEqual(["Vegetables & milk"]);
  expect(find({ q: "groceries" })).toEqual(["Vegetables & milk", "DMart"]);
  expect(find({ q: "18 nov" })).toEqual(["Rudrabhishek"]);
  expect(find({ q: "1890" })).toEqual(["Electricity bill"]);
  expect(find({ group: "food" })).toEqual(["Vegetables & milk", "Dinner at Sagar Ratna", "DMart"]);
  expect(find({ group: "food", method: "card" })).toEqual(["Dinner at Sagar Ratna", "DMart"]);
  expect(find({ q: "nothing like this" })).toEqual([]);
});

test("sorting: by any column, either way, a tie settled by the newest day", () => {
  const nov = within(ITEMS, periodRange({ kind: "month", ym: "2026-11" }, TODAY));
  const by = (key, dir) => sortItems(nov, key, dir, CATS).map((x) => x.title);
  expect(by("date", "desc")).toEqual(["Rudrabhishek", "Dinner at Sagar Ratna", "Vegetables & milk", "November rent"]);
  expect(by("date", "asc")).toEqual(["November rent", "Dinner at Sagar Ratna", "Vegetables & milk", "Rudrabhishek"]);
  expect(by("amount", "desc")).toEqual(["November rent", "Rudrabhishek", "Vegetables & milk", "Dinner at Sagar Ratna"]);
  expect(by("amount", "asc")[0]).toBe("Dinner at Sagar Ratna");
  expect(by("category", "asc")).toEqual(["Dinner at Sagar Ratna", "Vegetables & milk", "Rudrabhishek", "November rent"]);
  expect(by("title", "asc")[0]).toBe("Dinner at Sagar Ratna");
  expect(nov.map((x) => x.title)[0]).toBe("November rent"); // the list given is left as it was
});

test("the chart's bars: days for a month, months for a year, years for a long stretch — each with its parts by group", () => {
  const month = periodRange({ kind: "month", ym: "2026-11" }, TODAY);
  const days = bucketsFor(month);
  expect([days.unit, days.buckets.length, days.buckets[2]]).toEqual(["day", 30, { key: "2026-11-03", label: "3", long: "Tuesday, 3 Nov 2026", from: "2026-11-03", to: "2026-11-03" }]);
  const stacked = stack(within(ITEMS, month), days.buckets, CATS);
  expect([stacked[2].total, stacked[2].count, stacked[2].parts]).toEqual([1890.5, 2, { food: 1890.5 }]);
  expect([stacked[0].parts, stacked[1].total, stacked[17].parts]).toEqual([{ home: 25000 }, 0, { dharma: 2100 }]);

  const year = bucketsFor(periodRange({ kind: "year", y: 2026 }, TODAY));
  expect([year.unit, year.buckets.length, year.buckets[10].label, year.buckets[10].long]).toEqual(["month", 12, "Nov", "November 2026"]);
  const byMonth = stack(ITEMS, year.buckets, CATS);
  expect([byMonth[9].total, byMonth[9].parts, byMonth[10].total]).toEqual([27790, { home: 26890, food: 900 }, 28990.5]);
  expect(bucketsFor({ from: "2020-01-01", to: "2026-11-20" }).unit).toBe("year");
  expect(bucketsFor({ from: "2020-01-01", to: "2026-11-20" }).buckets.map((b) => b.key)).toEqual(["2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
});

test("the axis ends on a round figure, in four steps", () => {
  expect(niceScale(28990.5)).toEqual({ max: 40000, ticks: [0, 10000, 20000, 30000, 40000] });
  expect(niceScale(1890.5)).toEqual({ max: 2000, ticks: [0, 500, 1000, 1500, 2000] });
  expect(niceScale(950)).toEqual({ max: 1000, ticks: [0, 250, 500, 750, 1000] });
  expect(niceScale(0)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
  for (const top of [1, 7, 33, 199, 4200, 91000, 1250000]) expect(niceScale(top).max).toBeGreaterThanOrEqual(top);
});

test("where it went: groups largest first, each with its categories and its share of the whole", () => {
  const nov = within(ITEMS, periodRange({ kind: "month", ym: "2026-11" }, TODAY));
  const split = splitByGroup(nov, GROUPS, CATS);
  expect(total(nov)).toBe(28990.5);
  expect(split.map((g) => [g.id, g.total, g.count])).toEqual([["home", 25000, 1], ["dharma", 2100, 1], ["food", 1890.5, 2]]);
  expect(split[0].share).toBeCloseTo(25000 / 28990.5, 6);
  expect(split.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 6);
  expect(split[2].cats.map((c) => [c.label, c.total])).toEqual([["Groceries", 1250.5], ["Eating out", 640]]);
  expect(split[2].cats[0].share).toBeCloseTo(1250.5 / 1890.5, 6);
  // a category the list no longer knows is counted under Other, never lost
  expect(splitByGroup([e("2026-11-05", 10, "gone", "Old")], GROUPS, CATS)[0]).toMatchObject({ id: "other", total: 10 });
  expect(splitByGroup([], GROUPS, CATS)).toEqual([]);
});

test("month by month and year by year: totals, entries, per day and the biggest group, newest first", () => {
  const months = breakdown(ITEMS, "month", GROUPS, CATS, TODAY);
  expect(months.map((r) => [r.key, r.label, r.count, r.total])).toEqual([["2026-11", "November 2026", 4, 28990.5], ["2026-10", "October 2026", 3, 27790], ["2025-12", "December 2025", 1, 5000]]);
  expect(months[0].top).toEqual({ id: "home", label: "Home", total: 25000 });
  expect(months[0].perDay).toBeCloseTo(28990.5 / 20, 6); // 20 days of November have gone by
  expect(months[1].perDay).toBeCloseTo(27790 / 31, 6);
  const years = breakdown(ITEMS, "year", GROUPS, CATS, TODAY);
  expect(years.map((r) => [r.key, r.count, r.total])).toEqual([["2026", 7, 56780.5], ["2025", 1, 5000]]);
  expect(years[0].parts).toEqual({ home: 51890, food: 2790.5, dharma: 2100 });
});

test("the file to keep: one row an entry, oldest first, safe to open in a spreadsheet", () => {
  const csv = toCsv([...within(ITEMS, periodRange({ kind: "month", ym: "2026-11" }, TODAY)), e("2026-11-19", 50, "other", '=HYPERLINK("http://x","click")', "cash", 'said "hello", twice')], CATS, GROUPS, METHODS);
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toBe("Date,Amount (INR),Group,Category,What,Paid by,Note");
  expect(lines[1]).toBe("2026-11-01,25000.00,Home,Rent,November rent,netbanking,");
  expect(lines[2]).toBe("2026-11-03,1250.50,Food,Groceries,Vegetables & milk,Cash,weekly");
  expect(lines[4]).toBe("2026-11-18,2100.00,Dharma & giving,Puja & temple,Rudrabhishek,UPI,");
  // what looks like a formula is written so that it is shown, not run; quotes and commas are kept inside one cell
  expect(lines[5]).toBe('2026-11-19,50.00,Other,Other,"\'=HYPERLINK(""http://x"",""click"")",Cash,"said ""hello"", twice"');
  expect(lines.length).toBe(6);
});
