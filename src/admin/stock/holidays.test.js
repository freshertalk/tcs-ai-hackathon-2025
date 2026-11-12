import {
  nasdaqHolidays,
  indiaHolidays,
  weekdayClosures,
  nextClosure,
  isWeekend,
  addDays,
  daysBetween,
  todayIn,
  INDIA_YEARS,
  resolveNasdaq,
  indiaFreshness,
  INDIA_META,
} from "./holidays";

const closed = (year) => nasdaqHolidays(year).filter((h) => h.kind === "closed").map((h) => h.date);
const early = (year) => nasdaqHolidays(year).filter((h) => h.kind === "early").map((h) => h.date);

describe("NASDAQ calendar (computed)", () => {
  test("2026 matches the official Nasdaq Trader schedule", () => {
    expect(closed(2026)).toEqual([
      "2026-01-01", // New Year's Day
      "2026-01-19", // MLK
      "2026-02-16", // Presidents' Day
      "2026-04-03", // Good Friday
      "2026-05-25", // Memorial Day
      "2026-06-19", // Juneteenth
      "2026-07-03", // Independence Day, observed (July 4 is a Saturday)
      "2026-09-07", // Labor Day
      "2026-11-26", // Thanksgiving
      "2026-12-25", // Christmas
    ]);
    expect(early(2026)).toEqual(["2026-11-27", "2026-12-24"]); // not July 2
  });

  test("2025, including the one-off closure and its early closes", () => {
    expect(closed(2025)).toEqual([
      "2025-01-01",
      "2025-01-09", // National Day of Mourning
      "2025-01-20",
      "2025-02-17",
      "2025-04-18",
      "2025-05-26",
      "2025-06-19",
      "2025-07-04",
      "2025-09-01",
      "2025-11-27",
      "2025-12-25",
    ]);
    expect(early(2025)).toEqual(["2025-07-03", "2025-11-28", "2025-12-24"]);
  });

  test("2027: weekend holidays move to the nearest weekday; Easter and Saturday New Year work", () => {
    expect(closed(2027)).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26", // Good Friday (Easter is 28 March)
      "2027-05-31",
      "2027-06-18", // Juneteenth is a Saturday → Friday
      "2027-07-05", // July 4 is a Sunday → Monday
      "2027-09-06",
      "2027-11-25",
      "2027-12-24", // Christmas is a Saturday → Friday
    ]);
    // Christmas Eve is the observed holiday, so it is not also an early close
    expect(early(2027)).toEqual(["2027-11-26"]);
  });

  test("New Year's Day on a Saturday is not observed on the Friday", () => {
    // 1 Jan 2028 is a Saturday: no January holiday that year, and Dec 31 2027 trades
    expect(closed(2028)).not.toContain("2028-01-01");
    expect(closed(2028)).not.toContain("2027-12-31");
    expect(closed(2027)).not.toContain("2027-12-31");
  });

  test("Easter-dependent Good Friday over several years", () => {
    const gf = (y) => nasdaqHolidays(y).find((h) => h.name === "Good Friday").date;
    expect(gf(2024)).toBe("2024-03-29");
    expect(gf(2025)).toBe("2025-04-18");
    expect(gf(2026)).toBe("2026-04-03");
    expect(gf(2028)).toBe("2028-04-14");
  });

  test("Juneteenth only from 2022", () => {
    expect(nasdaqHolidays(2021).some((h) => h.name.startsWith("Juneteenth"))).toBe(false);
    expect(nasdaqHolidays(2022).some((h) => h.name.startsWith("Juneteenth"))).toBe(true);
  });

  test("an observed holiday explains itself", () => {
    const july = nasdaqHolidays(2026).find((h) => h.name === "Independence Day");
    expect(july.date).toBe("2026-07-03");
    expect(july.note).toMatch(/Saturday/);
  });

  test("never lists a closure on a weekend, and is sorted", () => {
    for (let y = 2022; y <= 2032; y += 1) {
      const list = nasdaqHolidays(y);
      list.forEach((h) => expect(isWeekend(h.date)).toBe(false));
      expect(list.map((h) => h.date)).toEqual([...list.map((h) => h.date)].sort());
    }
  });
});

describe("BSE / NSE calendar (published data)", () => {
  const list = indiaHolidays(2026);

  test("has 15 scheduled weekday holidays + the January 15 election closure", () => {
    const weekday = weekdayClosures(list);
    expect(weekday).toHaveLength(16);
    expect(weekday.filter((h) => h.tag !== "Added later")).toHaveLength(15);
    expect(weekday.find((h) => h.tag === "Added later").date).toBe("2026-01-15");
  });

  test("the exchanges' four weekend holidays do not cost a trading day", () => {
    // Mahashivratri (Sun), Id-Ul-Fitr (Sat), Independence Day (Sat) are plain closures;
    // the fourth, Diwali Laxmi Pujan (Sun 8 Nov), is listed as a Muhurat session instead
    const weekend = list.filter((h) => h.kind === "closed" && isWeekend(h.date));
    expect(weekend.map((h) => h.date)).toEqual(["2026-02-15", "2026-03-21", "2026-08-15"]);
    expect(list.find((h) => h.date === "2026-11-08").kind).toBe("special");
    weekend.forEach((h) => expect(weekdayClosures(list)).not.toContain(h));
  });

  test("special sessions are open days, not closures", () => {
    const special = list.filter((h) => h.kind === "special").map((h) => h.date);
    expect(special).toEqual(["2026-02-01", "2026-11-08"]);
    special.forEach((d) => expect(weekdayClosures(list).some((h) => h.date === d)).toBe(false));
  });

  test("weekdays in the data really are the weekdays the exchanges named", () => {
    const byDate = Object.fromEntries(list.map((h) => [h.date, h.name]));
    // spot checks against the published list (Mon=1 … Fri=5)
    const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
    expect(byDate["2026-01-26"]).toBe("Republic Day");
    expect(dow("2026-01-26")).toBe(1);
    expect(dow("2026-03-03")).toBe(2); // Holi, Tuesday
    expect(dow("2026-03-26")).toBe(4); // Ram Navami, Thursday
    expect(dow("2026-04-03")).toBe(5); // Good Friday, Friday
    expect(dow("2026-11-10")).toBe(2); // Balipratipada, Tuesday
    expect(dow("2026-12-25")).toBe(5); // Christmas, Friday
  });

  test("a year without data is empty, not an error", () => {
    expect(indiaHolidays(2031)).toEqual([]);
    expect(INDIA_YEARS).toContain(2026);
  });

  test("India and NASDAQ agree on Good Friday 2026", () => {
    expect(list.find((h) => h.name === "Good Friday").date).toBe(
      nasdaqHolidays(2026).find((h) => h.name === "Good Friday").date
    );
  });
});

describe("helpers", () => {
  test("nextClosure skips weekends and special sessions", () => {
    const list = indiaHolidays(2026);
    expect(nextClosure(list, "2026-11-11").name).toBe("Prakash Gurpurb Sri Guru Nanak Dev");
    expect(nextClosure(list, "2026-11-08").name).toBe("Diwali — Balipratipada"); // the 8th is a Sunday session
    expect(nextClosure(list, "2026-12-26")).toBeNull();
  });

  test("date arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-11", "2026-11-24")).toBe(13);
  });

  test("todayIn uses the zone's own date, not the viewer's", () => {
    // 18:45 UTC on 11 Nov is already 12 Nov in India (+5:30) but still 11 Nov in New York
    const t = new Date("2026-11-11T18:45:00Z");
    expect(todayIn("Asia/Kolkata", t)).toBe("2026-11-12");
    expect(todayIn("America/New_York", t)).toBe("2026-11-11");
  });
});

describe("official data beats the rule-based calendar", () => {
  const entry = (date, name, kind = "closed") => ({ date, name, kind, note: "", tag: "" });
  const officialFor2026 = () => ({
    years: {
      2026: {
        fetchedAt: "2026-11-12T10:00:00Z",
        changedAt: "2026-11-12T10:00:00Z",
        entries: nasdaqHolidays(2026).map((h) => entry(h.date, h.name, h.kind)),
      },
    },
  });

  test("with no official copy for the year, the rules are used and labelled as such", () => {
    const r = resolveNasdaq(2030, officialFor2026());
    expect(r.source).toBe("computed");
    expect(r.entries).toEqual(nasdaqHolidays(2030));
    expect(resolveNasdaq(2026, null).source).toBe("computed");
    expect(resolveNasdaq(2026, { years: {} }).source).toBe("computed");
  });

  test("an official copy is shown, and agrees with the rules for 2026", () => {
    const r = resolveNasdaq(2026, officialFor2026());
    expect(r.source).toBe("official");
    expect(r.differences).toEqual([]);
    expect(r.snapshot.changedAt).toBe("2026-11-12T10:00:00Z");
  });

  test("when the exchange changes its list, the page follows it and flags the difference", () => {
    const o = officialFor2026();
    // the exchange adds an unscheduled closure and drops the Dec 24 early close
    o.years[2026].entries = o.years[2026].entries.filter((e) => e.date !== "2026-12-24");
    o.years[2026].entries.push(entry("2026-12-31", "Unscheduled closure"));

    const r = resolveNasdaq(2026, o);
    expect(r.source).toBe("official");
    expect(r.entries.some((e) => e.date === "2026-12-31" && e.kind === "closed")).toBe(true);
    expect(r.entries.some((e) => e.date === "2026-12-24")).toBe(false); // the official list wins
    expect(r.differences).toEqual(["2026-12-24", "2026-12-31"]);
  });

  test("unknown kinds from the server cannot break the page", () => {
    const o = { years: { 2026: { entries: [{ date: "2026-01-01", name: "X", kind: "weird" }], changedAt: "x" } } };
    expect(resolveNasdaq(2026, o).entries[0].kind).toBe("closed");
  });
});

describe("India list freshness warning", () => {
  test("fine mid-year", () => {
    expect(indiaFreshness("2026-11-12").state).toBe("ok");
    expect(indiaFreshness("2026-01-02").state).toBe("ok");
  });

  test("from 1 December, a missing next-year list is flagged", () => {
    expect(indiaFreshness("2026-11-30").state).toBe("ok");
    const d = indiaFreshness("2026-12-01");
    expect(d.state).toBe("stale");
    expect(d.text).toMatch(/2027/);
  });

  test("a year with no list at all is flagged", () => {
    const w = indiaFreshness("2028-03-01");
    expect(w.state).toBe("stale");
    expect(w.text).toMatch(/2028/);
  });

  test("says when it was last checked by hand", () => {
    expect(INDIA_META.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
