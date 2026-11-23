import { indiaHolidays, resolveIndia } from "./holidays";

// NSE's own 2026 list as the server keeps it (server/holidays/nse.js on NSE's real answer of 23 Nov 2026)
const NSE_2026 = [
  ["2026-01-15", "Municipal Corporation Election - Maharashtra"],
  ["2026-01-26", "Republic Day"],
  ["2026-02-15", "Mahashivratri"],
  ["2026-03-03", "Holi"],
  ["2026-03-21", "Id-Ul-Fitr (Ramadan Eid)"],
  ["2026-03-26", "Shri Ram Navami"],
  ["2026-03-31", "Shri Mahavir Jayanti"],
  ["2026-04-03", "Good Friday"],
  ["2026-04-14", "Dr. Baba Saheb Ambedkar Jayanti"],
  ["2026-05-01", "Maharashtra Day"],
  ["2026-05-28", "Bakri Id"],
  ["2026-06-26", "Muharram"],
  ["2026-08-15", "Independence Day"],
  ["2026-09-14", "Ganesh Chaturthi"],
  ["2026-10-02", "Mahatma Gandhi Jayanti"],
  ["2026-10-20", "Dussehra"],
  ["2026-11-08", "Diwali Laxmi Pujan", "muhurat"],
  ["2026-11-10", "Diwali-Balipratipada"],
  ["2026-11-24", "Prakash Gurpurb Sri Guru Nanak Dev"],
  ["2026-12-25", "Christmas"],
].map(([date, name, kind = "closed"]) => ({ date, name, kind, note: kind === "muhurat" ? "Muhurat trading only" : "" }));
const nse = (entries = NSE_2026) => ({ years: { 2026: { entries, fetchedAt: "2026-11-23T14:00:00.000Z", changedAt: "2026-11-23T14:00:00.000Z" } } });

test("without NSE's list the table checked by hand is shown", () => {
  const v = resolveIndia(2026, null);
  expect(v.source).toBe("manual");
  expect(v.entries).toEqual(indiaHolidays(2026));
  expect(resolveIndia(2027, nse()).source).toBe("manual");
});

test("NSE's list is shown when the server has it, with the table's special sessions and notes kept", () => {
  const v = resolveIndia(2026, nse());
  expect(v.source).toBe("official");
  expect(v.differences).toEqual([]); // NSE and the table agree date for date
  const by = Object.fromEntries(v.entries.map((e) => [e.date, e]));
  expect(by["2026-11-24"]).toMatchObject({ name: "Prakash Gurpurb Sri Guru Nanak Dev", kind: "closed" });
  expect(by["2026-11-10"].name).toBe("Diwali-Balipratipada"); // NSE's own name
  expect(by["2026-11-08"]).toMatchObject({ kind: "special", tag: "Special session", name: "Diwali Laxmi Pujan — Muhurat trading" });
  expect(by["2026-02-01"]).toMatchObject({ kind: "special", name: "Union Budget — special trading session" }); // from the table
  expect(by["2026-01-15"].tag).toBe("Added later"); // the table's note on NSE's date
  expect(v.entries.map((e) => e.date)).toEqual([...v.entries.map((e) => e.date)].sort());
  expect(v.entries).toHaveLength(21);
});

test("a date where NSE and the table disagree is reported, and NSE's list wins", () => {
  const v = resolveIndia(2026, nse([...NSE_2026.filter((e) => e.date !== "2026-12-25"), { date: "2026-12-31", name: "Test closure", kind: "closed", note: "" }]));
  expect(v.differences).toEqual(["2026-12-25", "2026-12-31"]);
  expect(v.entries.some((e) => e.date === "2026-12-25")).toBe(false);
  expect(v.entries.find((e) => e.date === "2026-12-31").name).toBe("Test closure");
});
