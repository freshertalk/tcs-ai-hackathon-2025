import { ZONES, tzOffsetMinutes, isDst, formatUtcOffset, formatGap, compareTo, dayRelation, clockParts } from "./timezones";

const tz = (id) => ZONES.find((z) => z.id === id).tz;

// 12:00 UTC on 11 Nov 2026 — US daylight saving ended on 1 Nov; UK is on GMT
const WINTER = new Date("2026-11-11T12:00:00Z");
// 12:00 UTC on 1 Jul 2026 — US on EDT, UK on BST
const SUMMER = new Date("2026-07-01T12:00:00Z");

test("exactly the six requested places", () => {
  expect(ZONES.map((z) => z.label)).toEqual(["India", "USA", "Singapore", "UK", "Japan", "China"]);
});

describe("UTC offsets", () => {
  test("in winter", () => {
    const off = Object.fromEntries(ZONES.map((z) => [z.id, tzOffsetMinutes(z.tz, WINTER)]));
    expect(off).toEqual({ in: 330, us: -300, sg: 480, uk: 0, jp: 540, cn: 480 });
  });

  test("in summer the US and UK move an hour; Asia does not", () => {
    const off = Object.fromEntries(ZONES.map((z) => [z.id, tzOffsetMinutes(z.tz, SUMMER)]));
    expect(off).toEqual({ in: 330, us: -240, sg: 480, uk: 60, jp: 540, cn: 480 });
  });

  test("daylight saving is detected", () => {
    expect(isDst(tz("us"), WINTER)).toBe(false);
    expect(isDst(tz("us"), SUMMER)).toBe(true);
    expect(isDst(tz("uk"), WINTER)).toBe(false);
    expect(isDst(tz("uk"), SUMMER)).toBe(true);
    expect(isDst(tz("in"), SUMMER)).toBe(false);
    expect(isDst(tz("jp"), SUMMER)).toBe(false);
  });

  test("the instant of the US spring-forward flips the offset", () => {
    // 8 Mar 2026: clocks go 02:00 → 03:00 in New York, at 07:00 UTC
    expect(tzOffsetMinutes(tz("us"), new Date("2026-03-08T06:59:00Z"))).toBe(-300);
    expect(tzOffsetMinutes(tz("us"), new Date("2026-03-08T07:00:00Z"))).toBe(-240);
  });
});

describe("formatting", () => {
  test("UTC offset labels", () => {
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
    expect(formatUtcOffset(-300)).toBe("UTC−05:00");
    expect(formatUtcOffset(0)).toBe("UTC");
    expect(formatUtcOffset(540)).toBe("UTC+09:00");
  });

  test("gaps", () => {
    expect(formatGap(570)).toBe("9h 30m");
    expect(formatGap(-480)).toBe("8h");
    expect(formatGap(30)).toBe("0h 30m");
  });
});

describe("offset against a reference city", () => {
  test("against India (winter)", () => {
    const text = (id) => compareTo(tz(id), tz("in"), WINTER).text;
    expect(text("in")).toBe("Same time");
    expect(text("us")).toBe("−10h 30m");
    expect(text("sg")).toBe("+2h 30m");
    expect(text("uk")).toBe("−5h 30m");
    expect(text("jp")).toBe("+3h 30m");
    expect(text("cn")).toBe("+2h 30m");
  });

  test("the gap to the US shrinks by an hour when the US is on daylight time", () => {
    expect(compareTo(tz("us"), tz("in"), SUMMER).text).toBe("−9h 30m");
  });

  test("direction, and it flips when the reference changes", () => {
    expect(compareTo(tz("jp"), tz("in"), WINTER).direction).toBe("ahead");
    expect(compareTo(tz("us"), tz("in"), WINTER).direction).toBe("behind");
    expect(compareTo(tz("in"), tz("us"), WINTER).text).toBe("+10h 30m");
    expect(compareTo(tz("in"), tz("in"), WINTER).direction).toBe("same");
  });
});

describe("day relation", () => {
  test("late evening in India is still the same day in the UK, and the next day in Japan", () => {
    const t = new Date("2026-11-11T17:30:00Z"); // 23:00 India, 17:30 UK, 02:30 next day Japan
    expect(dayRelation(tz("uk"), tz("in"), t)).toBe("same day");
    expect(dayRelation(tz("jp"), tz("in"), t)).toBe("tomorrow");
    expect(dayRelation(tz("us"), tz("in"), t)).toBe("same day");
  });

  test("early morning in India is the previous day in the US", () => {
    const t = new Date("2026-11-11T03:00:00Z"); // 08:30 India, 22:00 (10 Nov) New York
    expect(dayRelation(tz("us"), tz("in"), t)).toBe("yesterday");
  });
});

describe("clock face", () => {
  test("24-hour and 12-hour faces", () => {
    const t = new Date("2026-11-11T12:34:56Z");
    const face = clockParts(tz("in"), t);
    expect(face).toMatchObject({ hm: "18:04", seconds: "56" });
    expect(face.date).toMatch(/^Wed,? 11 Nov$/); // comma or not depends on the browser's ICU version
    expect(clockParts(tz("us"), t)).toMatchObject({ hm: "07:34", seconds: "56" });
    const twelve = clockParts(tz("in"), t, true);
    expect(twelve.hm).toBe("06:04");
    expect(twelve.meridiem).toBe("pm");
  });

  test("midnight is 00:xx, never 24:xx", () => {
    expect(clockParts(tz("in"), new Date("2026-11-11T18:30:30Z")).hm).toBe("00:00");
  });
});
